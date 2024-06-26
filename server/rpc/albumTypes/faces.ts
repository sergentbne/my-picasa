import * as tf from "@tensorflow/tfjs-node";
import * as faceapi from "@vladmandic/face-api";
import { mkdir, readFile } from "fs/promises";
import { join } from "path";
import { lock } from "../../../shared/lib/mutex";
import { Queue } from "../../../shared/lib/queue";
import {
  FaceList,
  buildReadySemaphore,
  debounce,
  decodeFaces,
  decodeRect,
  encodeFaces,
  encodeRect,
  fromBase64,
  isAnimated,
  isPicture,
  jsonifyObject,
  pathForEntryMetadata,
  setReady,
  sleep,
  toBase64,
  uuid,
} from "../../../shared/lib/utils";
import {
  Album,
  AlbumEntry,
  AlbumKind,
  AlbumMetaData,
  AlbumWithData,
  Contact,
  FaceData,
  HashInAlbumList,
  keyFromID,
} from "../../../shared/types/types";
import { getFolderAlbums, waitUntilWalk } from "../../background/bg-walker";
import { Features, facesFolder } from "../../utils/constants";
import {
  entryFilePath,
  fileExists,
  safeWriteFile,
} from "../../utils/serverUtils";
import { socketCount } from "../../utils/socketList";
import { media } from "../rpcFunctions/albumUtils";
import {
  getPicasaEntry,
  listAlbumsOfKind,
  readAlbumEntries,
  readAlbumIni,
  updatePicasa,
  updatePicasaEntry,
} from "../rpcFunctions/picasa-ini";
import { deleteFaceImage, getFaceImage } from "../rpcFunctions/thumbnail";

export async function eraseFace(entry: AlbumEntry) {
  if (entry.album.kind !== AlbumKind.FACE) {
    throw new Error("Not a face album");
  }
  await deleteFaceImage(entry);
  const d = await getFaceData(entry);

  const originalImageEntry = d.originalEntry;
  // entry.name is the face hash
  updatePicasa(entry.album, null, null, entry.name);

  // Update entry in original picasa.ini
  let iniFaces = (await getPicasaEntry(originalImageEntry))?.faces;
  if (iniFaces) {
    iniFaces = iniFaces
      .split(";")
      .filter((f) => !f.includes(`,${d.hash}`))
      .join(";");
    updatePicasaEntry(originalImageEntry, "faces", iniFaces);
  }
}

export function getFaceAlbums(): AlbumWithData[] {
  return Object.values(faceAlbumsByName);
}

export async function getFaceData(entry: AlbumEntry): Promise<FaceData> {
  const picasaEntry = await getPicasaEntry(entry);
  const originalEntry: AlbumEntry = {
    album: {
      key: picasaEntry.originalAlbumKey!,
      name: picasaEntry.originalAlbumName!,
      kind: AlbumKind.FOLDER,
    },
    name: picasaEntry.originalName!,
  };

  const [albumKey, label, face] = JSON.parse(fromBase64(entry.name));
  return { originalEntry, label, ...face, faceAlbum: entry.album };
}

export async function readFaceAlbumEntries(
  album: Album
): Promise<AlbumEntry[]> {
  return await readAlbumEntries(album);
}

export async function startFaceScan() {
  const faceAlbums = await listAlbumsOfKind(AlbumKind.FACE);
  const albumAndData: [Album, AlbumEntry[]][] = await Promise.all(
    faceAlbums.map(async (album) => [album, await readFaceAlbumEntries(album)])
  );
  const albumWithData: AlbumWithData[] = albumAndData.map((a) => ({
    ...a[0],
    count: a[1].length,
  }));
  for (const albumData of albumWithData)
    faceAlbumsByName[albumData.key] = { ...albumData, hash: [] };
  setReady(readyLabelKey);
  await tf.ready;
  await waitUntilWalk();
  if (!Features.faces) {
    return;
  }
  optionsSSDMobileNet = new faceapi.SsdMobilenetv1Options({
    minConfidence: 0.5,
    maxResults: 100,
  });
  const modelPath = join(
    require.resolve("@vladmandic/face-api"),
    "..",
    "..",
    "model"
  );
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
  await faceapi.nets.ageGenderNet.loadFromDisk(modelPath);
  await faceapi.nets.faceExpressionNet.loadFromDisk(modelPath);

  while (true) {
    const albums = await getFolderAlbums();
    await readReferenceFeatures();
    // Scan all the contacts
    for (const album of albums) {
      const picasaIni = await readAlbumIni(album);
      const contacts = readContacts(picasaIni);
      for (const [hash, contact] of Object.entries(contacts)) {
        allContacts[contact.key] = contact;
        if (!faceAlbumsByName[contact.key]) {
          const faceAlbum: FaceAlbum = {
            count: 0,
            name: contact.originalName,
            key: contact.key,
            hash: [],
            kind: AlbumKind.FACE,
          };
          faceAlbumsByName[contact.key] = faceAlbum;
        }
        const faceAlbum = faceAlbumsByName[contact.key]!;
        faceAlbumsByHash[hash] = faceAlbum;
        if (!faceAlbumsByHash[hash]) {
          faceAlbumsByHash[hash] = faceAlbum;
        }
      }
    }
    const inProgress = new Set<Album>();
    for (const album of albums) {
      faceProcessingQueue.add(async () => {
        inProgress.add(album);
        //await processFaces(album).catch(console.error);
        inProgress.delete(album);
      });
    }
    const t = setInterval(
      () =>
        console.info(
          `Processing faces. Remaining ${faceProcessingQueue.length()} albums to process.`
        ),
      2000
    );
    await faceProcessingQueue.drain();
    clearInterval(t);
    await joinUnmatchedFeatures();
    await exportAllFaces();

    await sleep(24 * 60 * 60);
  }
}

export function getFaceAlbumFromHash(hash: string): FaceAlbum {
  return faceAlbumsByHash[hash];
}

export async function getFaceAlbumsWithData(
  _filter: string = ""
): Promise<AlbumWithData[]> {
  // Create 'fake' albums with the faces
  await ready;
  return getFaceAlbums();
}

/**
 * Merge all the contents of withFace into face
 * @param face
 * @param withFace
 * @returns
 */
export async function mergeFaces(face: string, withFace: string) {
  // Find all the albums where the hashes for the withFace album appears, and reassign them
  const inAlbum = faceAlbumsByName[face];
  if (!inAlbum) {
    throw `Face album ${face} not found`;
  }
  const fromAlbum = faceAlbumsByName[withFace];
  if (!fromAlbum) {
    throw `Face album ${withFace} not found`;
  }
  const toEntries = await media(inAlbum);
  const fromEntries = await media(fromAlbum);
  for (const entry of fromEntries.entries) {
    const faceData = await getFaceData(entry);

    faceData.hash;
  }
}

// Limit the parallelism for the face parsing
const faceProcessingQueue = new Queue(30);

/**
 * all the known face albums
 */
type FaceAlbum = AlbumWithData & { hash: string[] } & {
  [key: string]: any;
};

type FaceLandmarkData = { hash?: string } & faceapi.WithAge<
  faceapi.WithGender<
    faceapi.WithFaceExpressions<
      faceapi.WithFaceDescriptor<
        faceapi.WithFaceLandmarks<
          {
            detection: faceapi.FaceDetection;
          },
          faceapi.FaceLandmarks68
        >
      >
    >
  >
>;

let faceAlbumsByName: { [name: string]: FaceAlbum } = {};
let faceAlbumsByHash: { [hash: string]: FaceAlbum } = {};
let allContacts: { [contactKey: string]: Contact } = {};
const hashToReferenceFeature: { [hash: string]: FaceLandmarkData } = {};

let matcher: faceapi.FaceMatcher | undefined;
async function readReferenceFeatures() {
  try {
    const buf = await readFile(join(facesFolder, "referenceFeatures.json"), {
      encoding: "utf-8",
    });
    const d = JSON.parse(buf);
    Object.assign(hashToReferenceFeature, d);
  } catch (e) {
    // Do nothing
  }
}

async function writeReferenceFeatures() {
  return debounce(
    async () => {
      await safeWriteFile(
        join(facesFolder, "referenceFeatures.json"),
        JSON.stringify(hashToReferenceFeature)
      );
    },
    20000,
    "writeReferenceFeatures",
    false
  );
}
function referenceFeaturesPath(entry: AlbumEntry) {
  const path = pathForEntryMetadata(entry);
  return {
    path: join(facesFolder, "references", ...path.path),
    file: `${path.filename}.json`,
  };
}

async function readFeaturesOfEntry(entry: AlbumEntry) {
  try {
    const c = referenceFeaturesPath(entry);
    const path = join(c.path, c.file);
    const buf = await readFile(path, {
      encoding: "utf-8",
    });
    return JSON.parse(buf) as FaceLandmarkData[];
  } catch (e) {
    return undefined;
  }
}
async function writeFeaturesOfEntry(
  entry: AlbumEntry,
  data: FaceLandmarkData[]
) {
  const p = referenceFeaturesPath(entry);
  return debounce(
    async () => {
      await mkdir(p.path, { recursive: true });
      await safeWriteFile(join(p.path, p.file), JSON.stringify(data));
    },
    20000,
    p.file,
    false
  );
}

let parsedFaces = new Set<string>();
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/^[a-z]|[\s|-][a-z]/gi, (s) => {
    return s.toUpperCase();
  });
}

/**
 * Export all faces to a folder
 */
async function exportAllFaces() {
  const getFaceImageQueue = new Queue(4, { fifo: false });
  const albums = await getFaceAlbums();
  await Promise.all(
    albums.map(async (album) => {
      const entries = await media(album);
      await Promise.all(
        entries.entries.map(async (entry) =>
          getFaceImageQueue.add(() => getFaceImage(entry, true))
        )
      );
    })
  );
  await getFaceImageQueue.drain();
}

function readContacts(picasaIni: AlbumMetaData): HashInAlbumList {
  if (picasaIni.Contacts2) {
    // includes a map of faces/ids
    return Object.fromEntries(
      Object.entries(picasaIni.Contacts2 as { [key: string]: string }).map(
        ([hash, value]) => {
          const [originalName, email, something] = value.split(";");
          const name = normalizeName(originalName);
          const key = keyFromID(name, AlbumKind.FACE);
          return [hash, { originalName, email, something, name, key }];
        }
      )
    );
  }
  return {};
}

const createdContacts: { [hash: string]: Contact } = {};
function addNewFaceHash(entry: AlbumEntry, feature: FaceLandmarkData) {
  const hash = `facehash:${uuid()}`;
  feature.hash = hash;
  const left = feature.alignedRect.box.left / feature.detection.imageWidth;
  const right = feature.alignedRect.box.right / feature.detection.imageWidth;
  const top = feature.alignedRect.box.top / feature.detection.imageHeight;
  const bottom = feature.alignedRect.box.bottom / feature.detection.imageHeight;

  const rect = encodeRect({ top, left, right, bottom });
  console.info(
    `Creating new hash in entry ${entry.album.name}/${entry.name} : ${hash} (rect is ${rect})`
  );
  const originalName = "Unknown person added on " + new Date().toISOString();
  const name = normalizeName(originalName);
  const key = keyFromID(name, AlbumKind.FACE);
  const contact: Contact = {
    originalName,
    email: "",
    something: "",
    key,
  };
  addContact(entry.album, hash, contact);
  const faceAlbum: FaceAlbum = {
    count: 0,
    name: contact.originalName,
    key: contact.key,
    hash: [],
    kind: AlbumKind.FACE,
  };
  faceAlbumsByName[contact.key] = faceAlbum;

  faceAlbumsByHash[hash] = faceAlbum;

  createdContacts[hash] = contact;
  addFaceRectToEntry(entry, rect, hash);
  // TODO Generate thumbnail
  return hash;
}

function setFaceHash(
  entry: AlbumEntry,
  hash: string,
  feature: FaceLandmarkData
) {
  feature.hash = hash;
  const left = feature.alignedRect.box.left / feature.detection.imageWidth;
  const right = feature.alignedRect.box.right / feature.detection.imageWidth;
  const top = feature.alignedRect.box.top / feature.detection.imageHeight;
  const bottom = feature.alignedRect.box.bottom / feature.detection.imageHeight;

  const rect = encodeRect({ top, left, right, bottom });
  const contact = createdContacts[hash];
  addContact(entry.album, hash, contact);
  addFaceRectToEntry(entry, rect, hash);
  // TODO Generate thumbnail
  return hash;
}

async function joinUnmatchedFeatures() {
  const albums = await getFolderAlbums();
  for (const album of albums) {
    const entries = await media(album);
    let references: faceapi.LabeledFaceDescriptors[] = [];

    for (const entry of entries.entries) {
      const features = await readFeaturesOfEntry(entry);
      if (!features) continue;
      for (const feature of features) {
        if (!feature.hash) {
          if (matcher === undefined) {
            if (references.length === 0) {
              const newHash = addNewFaceHash(entry, feature);
              writeFeaturesOfEntry(entry, features);

              references.push(
                new faceapi.LabeledFaceDescriptors(newHash, [
                  Float32Array.from(feature.descriptor),
                ])
              );
            }
            matcher = new faceapi.FaceMatcher(references, 0.8);
            continue;
          }

          const bestMatch = matcher!.findBestMatch(feature.descriptor);
          if (bestMatch && bestMatch.distance < 0.1) {
            setFaceHash(entry, bestMatch.label, feature);
            console.info(
              `Found a similar person in other hash (was hash ${bestMatch.label})`
            );
          } else {
            const newHash = addNewFaceHash(entry, feature);
            writeFeaturesOfEntry(entry, features);
            references.push(
              new faceapi.LabeledFaceDescriptors(newHash, [
                Float32Array.from(feature.descriptor),
              ])
            );
            matcher = undefined;
          }
        }
      }
    }
  }
}

async function addContact(album: Album, hash: string, contact: Contact) {
  updatePicasa(
    album,
    hash,
    [contact.originalName, contact.email, contact.something].join(";"),
    "Contacts2"
  );
}
async function addFaceRectToEntry(
  entry: AlbumEntry,
  rect: string,
  hash: string
) {
  const current = await getPicasaEntry(entry);
  const iniFaces = current.faces || "";
  const faces = decodeFaces(iniFaces);
  faces.push({
    hash,
    rect,
  });
  const album = faceAlbumsByHash[hash];
  const contact = allContacts[album.key];
  addContact(entry.album, hash, contact);
  return updatePicasaEntry(entry, "faces", encodeFaces(faces));
}
async function getClosestHashedFeature(feature: FaceLandmarkData) {
  let match: faceapi.FaceMatch | undefined;
  if (matcher === undefined) {
    const references = Object.entries(hashToReferenceFeature).map(
      ([hash, desc]) =>
        new faceapi.LabeledFaceDescriptors(hash, [
          Float32Array.from(desc.descriptor),
        ])
    );
    if (references.length > 0)
      matcher = new faceapi.FaceMatcher(references, 0.8);
  }
  if (matcher) {
    matcher.labeledDescriptors;
    match = matcher.findBestMatch(feature.descriptor);
  }
  if (match && match.distance < 0.2) {
    // Good one !
    const hash = (feature.hash = match.label);
    console.info(
      `Face feature matching with derived hash ${hash} [${faceAlbumsByHash[hash]?.name} with feature age ${feature.age} / ${feature.gender}]`
    );
    return hash;
  }
  return undefined;
}

async function getOrCreateFeatureFile(entry: AlbumEntry) {
  const imagePath = entryFilePath(entry);
  const exists = await fileExists(imagePath);
  if (isPicture(entry) && !isAnimated(entry)) {
    if (exists) {
      let detectedFeatures = await readFeaturesOfEntry(entry);
      if (!detectedFeatures) {
        console.info(`Will generate features of file ${imagePath}`);
        const l = await lock(imagePath);
        try {
          const buffer = await readFile(imagePath);
          // Load image
          const tensor = tf.tidy(() =>
            tf.node
              .decodeImage(buffer, 3, undefined, true)
              .toFloat()
              .expandDims()
          );
          //const tensor = tf.node.decodeImage(buffer, undefined, undefined, true);
          //const expandT = tf.expandDims(tensor, 0); // add batch dimension to tensor
          const faceFeatures = await faceapi
            .detectAllFaces(
              tensor as any, // as any because of some input issues
              optionsSSDMobileNet
            )
            .withFaceLandmarks()
            .withFaceExpressions()
            .withAgeAndGender()
            .withFaceDescriptors();
          tf.dispose(tensor);

          detectedFeatures = jsonifyObject(faceFeatures) as FaceLandmarkData[];
          writeFeaturesOfEntry(entry, detectedFeatures);
        } catch (e) {
          console.warn(imagePath, e, entry);
          detectedFeatures = [];
          writeFeaturesOfEntry(entry, detectedFeatures);
        } finally {
          l();
        }
      }
      return detectedFeatures;
    }
  }
  return undefined;
}
async function processFaces(album: Album) {
  if (album.key.normalize() !== album.key) {
    debugger;
  }
  const picasaIni = await readAlbumIni(album);
  if (parsedFaces.has(album.key)) {
    return;
  }
  const contacts = readContacts(picasaIni);
  parsedFaces.add(album.key);
  const entries = await media(album);
  for (const entry of entries.entries) {
    // Only process faces when no user is connected
    while (socketCount() !== 0) {
      await sleep(1);
    }
    const imagePath = entryFilePath(entry);
    const exists = await fileExists(imagePath);
    let facesInEntry: FaceList = [];
    const iniFaces = picasaIni[entry.name].faces;
    if (iniFaces) {
      // Example:faces=rect64(9bff22f6ad443ebb),d04ca592f8868c2;rect64(570c6e79670c8820),4f3f1b40e69b2537;rect64(b8512924c7ae41f2),69618ff17d8c570f
      facesInEntry = decodeFaces(iniFaces);
    }
    for (const face of facesInEntry) {
      if (!contacts[face.hash]) {
        const contact = allContacts[faceAlbumsByHash[face.hash]?.name];
        if (contact) addContact(album, face.hash, contact);
      }
    }
    const detectedFeatures = await getOrCreateFeatureFile(entry);
    const notHashed = detectedFeatures
      ? detectedFeatures.filter((f) => !f.hash)
      : [];

    // Go through each detected features, try to find features with no associated hashes
    if (notHashed.length === 0) continue;

    const { width, height } = notHashed[0].detection.imageDims;

    // Map them on identified areas
    for (const feature of notHashed) {
      const [x, y] = [
        feature.alignedRect.box.x + feature.alignedRect.box.width / 2,
        feature.alignedRect.box.y + feature.alignedRect.box.height / 2,
      ];
      for (const [index, f] of facesInEntry.entries()) {
        const facePos = decodeRect(f.rect);
        if (
          width * facePos.left < x &&
          width * facePos.right > x &&
          height * facePos.top < y &&
          height * facePos.bottom > y
        ) {
          // This is a match
          console.info(
            `Face feature matching with hash ${f.hash} [${
              faceAlbumsByHash[f.hash]?.name
            } with feature age ${feature.age} / ${feature.gender}]`
          );
          feature.hash = f.hash;
          // Update the detected features file, as it has been modified
          writeFeaturesOfEntry(entry, detectedFeatures!);
          if (!hashToReferenceFeature[f.hash]) {
            hashToReferenceFeature[f.hash] = feature;
            matcher = undefined;
            writeReferenceFeatures();
          }
          break;
        }
      }
      // Not found in the rects, get the closest
      const hash = await getClosestHashedFeature(feature);
      if (hash) {
        feature.hash = hash;
        writeFeaturesOfEntry(entry, detectedFeatures!);
        const ref = hashToReferenceFeature[hash]!;
        const rect = encodeRect({
          left: ref.alignedRect.box.left / width,
          right: ref.alignedRect.box.right / width,
          top: ref.alignedRect.box.top / height,
          bottom: ref.alignedRect.box.bottom / height,
        });
        addFaceRectToEntry(entry, rect, hash);
      } else {
        //addUnmatchedFeature(entry, feature);
      }

      // Update the "person albums" to contain references to hash and rects
      // Example:faces=rect64(9bff22f6ad443ebb),d04ca592f8868c2;rect64(570c6e79670c8820),4f3f1b40e69b2537;rect64(b8512924c7ae41f2),69618ff17d8c570f
      for (const face of facesInEntry) {
        const faceAlbum = faceAlbumsByHash[face.hash];
        if (faceAlbum) {
          faceAlbum.count++;
          if (album.key.normalize() !== album.key) {
            debugger;
          }
          const sectionName = toBase64(
            JSON.stringify([album.key, entry.name, face])
          );

          if (exists) {
            updatePicasa(
              faceAlbum,
              "originalAlbumName",
              album.name,
              sectionName
            );
            updatePicasa(faceAlbum, "originalAlbumKey", album.key, sectionName);
            updatePicasa(faceAlbum, "originalName", entry.name, sectionName);
          } else {
            updatePicasa(faceAlbum, "originalAlbumName", null, sectionName);
            updatePicasa(faceAlbum, "originalAlbumKey", null, sectionName);
            updatePicasa(faceAlbum, "originalName", null, sectionName);
          }
        }
      }
    }
  }
}

/**
 *
 * @returns
 */
const readyLabelKey = "faceWalker";
const ready = buildReadySemaphore(readyLabelKey);
let optionsSSDMobileNet: faceapi.SsdMobilenetv1Options;

/*
let data = { ...(await readAlbumIni(album)) };

const faceIds: string[] = [];
for (const [id, val] of faces.entries()) {
  if (val.name.toLowerCase().includes(normalizedFilter)) {
    faceIds.push(id);
  }
}
const res: AlbumEntry[] = [];
Object.entries(data).forEach(([name, picasaEntry]) => {
  if (name.toLowerCase().includes(normalizedFilter)) {
    res.push({ album, name });
    return;
  }
  if (album.name.toLowerCase().includes(normalizedFilter)) {
    res.push({ album, name });
    return;
  }
  if (picasaEntry.faces) {
    for (const id of faceIds) {
      if (picasaEntry.faces.includes(id)) {
        res.push({ album, name });
        return;
      }
    }
  }
});
if (res.length > 0) {
}
return res;
*/
