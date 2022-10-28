import { spawn } from "child_process";
import { copyFile, mkdir, utimes, writeFile } from "fs/promises";
import { join } from "path";
import { Queue } from "../../../shared/lib/queue";
import { isPicture, isVideo } from "../../../shared/lib/utils";
import { Album, Job } from "../../../shared/types/types";
import { exportsRoot, PhotoLibraryPath } from "../../utils/constants";
import {
  entryFilePath,
  mediaName,
  removeExtension
} from "../../utils/serverUtils";
import { buildImage } from "../imageOperations/sharp-processor";
import { toExifDate } from "./exif";
import { media } from "./media";
import { importScript } from "./osascripts";
import { readPicasaIni } from "./picasaIni";
import { folders, waitUntilWalk } from "./walker";

function photoLibrary() {
  return join(PhotoLibraryPath, "database", "Photos.sqlite");
}

function pruneExtraData(fileName: string) {
  return removeExtension(fileName)
    .replace(/(^[^0-9a-z]*)|([^0-9a-z]*$)/gi, "")
    .toLowerCase();
}

async function allPhotosInPhotoApp(): Promise<string[]> {
  async function read(stream: any) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }

  const list = await read(
    spawn("sqlite3", [
      photoLibrary(),
      "select ZORIGINALFILENAME  from ZADDITIONALASSETATTRIBUTES",
    ]).stdout
  );
  return list.split("\n").map(pruneExtraData);
}
export async function exportAllFavoritesJob(job: Job): Promise<Album[]> {
  const parsingImages = allPhotosInPhotoApp();
  await waitUntilWalk();
  job.status = "started";

  const allPics = await parsingImages;
  // Job with no parameters
  const albums = await folders("");

  job.progress.remaining = job.progress.start = albums.length;
  job.changed();

  const missingPicturePath: string[] = [];

  const targetFolder = join(
    exportsRoot,
    "exports-" + new Date().toLocaleString().replace(/\//g, "-")
  );
  await mkdir(targetFolder, { recursive: true });

  const q = new Queue(3);
  q.event.on("changed", (event) => {
    job.progress.remaining = event.waiting + event.progress;
    job.progress.start = event.done + event.progress + event.waiting;
    job.changed();
  });
  q.event.on("drain", async () => {
    job.progress.remaining = 1;
    job.changed();
    await copyInPhotoApp(missingPicturePath);
    job.progress.remaining = 0;
    job.changed();
  });
  for (const album of albums) {
    q.add(async () => {
      const p = await readPicasaIni(album);
      const m = await media(album);

      for (const entry of m.entries) {
        if (p[entry.name].star) {
          const targetPictureFileName = entry.album.name + "-" + entry.name;
          if (allPics.includes(pruneExtraData(targetPictureFileName))) {
            continue;
          }
          q.add(async () => {
            // Create target file name
            const targetFileName = join(targetFolder, targetPictureFileName);
            if (isPicture(entry)) {
              // resize + rename + label
              const imageLabel = mediaName(entry);
              const transform = p[entry.name].filters || "";
              const exif = {
                IFD0: {
                  DateTime: toExifDate(p[entry.name].dateTaken!),
                },
                IFD2: {
                  DateTimeOriginal: toExifDate(p[entry.name].dateTaken!),
                }
              };
              const res = await buildImage(
                entry,
                p[entry.name],
                transform +
                  `;resize=1,1500;label=1,${encodeURIComponent(
                    imageLabel
                  )},25,south;exif=${encodeURIComponent(JSON.stringify(exif))}`,
                []
              );
              await writeFile(targetFileName, res.data);
              missingPicturePath.push(targetFileName);
            }
            if (isVideo(entry)) {
              // copy file
              await copyFile(entryFilePath(entry), targetFileName);
              function albumNameToDate(name: string) : Date {
                let [y, m, d] = name.split('-').map(parseInt);
                if(y > 1800) {
                  if(m<0 || m>12 || Number.isNaN(m)) {
                    m = 1;
                  }
                  if(d<0 || d>31 || Number.isNaN(d)) {
                    d = 1
                  }
                }
                return new Date(y,m,d,12);
              }
              await utimes(targetFileName, albumNameToDate(entry.album.name), albumNameToDate(entry.album.name));
              missingPicturePath.push(targetFileName);
            }
          });
        }
      }
    });
  }
  async function copyInPhotoApp(files: string[]) {
    const osascript = importScript(files);
    await writeFile("/tmp/importScript", osascript);
    return new Promise((resolve) =>
      spawn("osascript", ["/tmp/importScript"]).on("close", resolve)
    );
  }
  return [];
}
