import { copyFile, mkdir, rename, stat } from "fs/promises";
import { basename, dirname, extname, join, relative, sep } from "path";
import { sleep, uuid } from "../../../shared/lib/utils";
import {
  Album,
  AlbumEntry,
  Job,
  JobData,
  JOBNAMES
} from "../../../shared/types/types";
import { openExplorer } from "../../open";
import { exportsRoot, imagesRoot } from "../../utils/constants";
import { fileExists } from "../../utils/serverUtils";
import { broadcast } from "../../utils/socketList";
import { addToUndo, registerUndoProvider } from "../../utils/undo";
import { exportToFolder } from "../imageOperations/export";
import { setRank } from "./media";
import { readPicasaEntry, readPicasaIni, updatePicasaEntry } from "./picasaIni";
import { copyThumbnails } from "./thumbnailCache";
import { refreshAlbums } from "./walker";

const jobs: Job[] = [];
type MultiMoveJobArguments = {source: AlbumEntry, destination: Album, rank: Number}[];

export async function getJob(id: string): Promise<object> {
  const j = jobs.filter((j) => j.id === id);
  if (j.length) {
    if (typeof j[0] === "undefined") debugger;
    return j[0];
  }
  throw new Error("Not Found");
}

function deleteFSJob(job: Job) {
  jobs.splice(jobs.indexOf(job), 1);
  broadcast("jobDeleted", job);
}

export async function createFSJob(
  jobName: string,
  jobArgs: object
): Promise<string> {
  const job: Job = {
    id: uuid(),
    name: jobName,
    data: jobArgs as JobData,
    status: "queued",
    progress: {
      start: 0,
      remaining: 0,
    },
    errors: [],
    changed: () => {
      broadcast("jobChanged", job);
    },
  };
  jobs.push(job);
  executeJob(job)
    .then(async (updatedAlbums: Album[]) => {
      broadcast("jobFinished", job);
      if (updatedAlbums.length) {
        refreshAlbums(updatedAlbums);
      }
    })
    .catch((err: Error) => {
      job.errors.push(err.message);
      job.status = "finished";
    })
    .finally(async () => {
      await sleep(10);
      deleteFSJob(job);
    });
  return job.id;
}

async function executeJob(job: Job): Promise<Album[]> {
  switch (job.name) {
    case JOBNAMES.MOVE:
      return moveJob(job);
    case JOBNAMES.MULTI_MOVE:
      return multiMoveJob(job);
    case JOBNAMES.COPY:
      return copyJob(job);
    case JOBNAMES.DUPLICATE:
      return duplicateJob(job);
    case JOBNAMES.EXPORT:
      return exportJob(job);
    case JOBNAMES.DELETE:
      return deleteJob(job);
    case JOBNAMES.RESTORE:
      return restoreJob(job);
    case JOBNAMES.DELETE_ALBUM:
      return deleteAlbumJob(job);
    case JOBNAMES.RESTORE_ALBUM:
      return restoreAlbumJob(job);
    case JOBNAMES.RENAME_ALBUM:
      return renameAlbumJob(job);
    default:
      job.status = "finished";
      job.errors.push(`Unknown job name ${job.name}`);
      break;
  }
  return [];
}

registerUndoProvider(JOBNAMES.MULTI_MOVE, (operation, payload) => {
  createFSJob(operation, payload);
});
registerUndoProvider(JOBNAMES.RENAME_ALBUM, (operation, payload) => {
  createFSJob(operation, payload);
});
registerUndoProvider(JOBNAMES.RESTORE_ALBUM, (operation, payload) => {
  createFSJob(operation, payload);
});
registerUndoProvider(JOBNAMES.RESTORE, (operation, payload) => {
  createFSJob(operation, payload);
});

function albumChanged(album: Album, list: Album[]) {
  if (!list.find((a) => a.key === album.key)) list.push(album);
}

async function moveJob(job: Job): Promise<Album[]> {
  // convert to a multi-move
  const source = job.data.source as AlbumEntry[];
  const target = job.data.destination as Album;
  let targetRank = job.data.argument || 0;
  const mmArgs:MultiMoveJobArguments = source.map((entry, index) => ({
    source: entry,
    destination: target,
    rank: targetRank++
  }));
  job.data.source = mmArgs;
  job.data.destination = undefined;
  job.data.argument = undefined;


  return multiMoveJob(job);
}

async function copyJob(job: Job): Promise<Album[]> {
  job.status = "started";
  const updatedAlbums: Album[] = [];
  const source = job.data.source as AlbumEntry[];
  const dest = job.data.destination as Album;
  const steps = source.length;
  job.progress.start = steps;
  job.progress.remaining = steps;
  job.changed();
  await Promise.allSettled(
    source.map(async (s) => {
      try {
        let targetName = s.name;
        let found = false;
        let idx = 1;
        while (!found) {
          let destPath = join(imagesRoot, dest.key, targetName);
          found = true;
          if (await fileExists(destPath)) {
            // target already exists
            found = false;
            const ext = extname(s.name);
            const base = basename(s.name, ext);
            targetName = base + ` (${idx++})` + ext;
            destPath = join(imagesRoot, dest.key);
          }
        }

        await copyFile(
          join(imagesRoot, s.album.key, s.name),
          join(imagesRoot, dest.key, targetName)
        );
        await copyMetadata(s, { album: dest, name: targetName }, false);
        albumChanged(dest, updatedAlbums);
      } catch (e: any) {
        job.errors.push(e.message as string);
      } finally {
        job.progress.remaining--;
        job.changed();
      }
    })
  );
  job.status = "finished";
  job.changed();
  return updatedAlbums;
}

async function duplicateJob(job: Job): Promise<Album[]> {
  const source = job.data.source as AlbumEntry[];
  job.data.destination = source[0].album;
  return copyJob(job);
}

async function deleteAlbumJob(job: Job): Promise<Album[]> {
  const undoDeleteAlbumPayload = {
    source: [] as Album[],
    noUndo: true,
  };

  // Deleting a set of images means renaming them
  job.status = "started";
  const updatedAlbums: Album[] = [];
  const source = job.data.source as Album;
  job.progress.start = 1;
  job.progress.remaining = 1;
  job.changed();

  const from = join(imagesRoot, source.key);
  const to = join(dirname(from), "." + basename(from));
  const altKey = relative(imagesRoot, to);
  try {
    await rename(from, to);
    undoDeleteAlbumPayload.source.push({ name: source.name, key: altKey });
    albumChanged(source, updatedAlbums);
  } catch (e: any) {
    job.errors.push(e.message as string);
  } finally {
    job.progress.remaining--;
    job.changed();
  }
  addToUndo(
    JOBNAMES.RESTORE_ALBUM,
    `Delete album ${source.name}`,
    undoDeleteAlbumPayload
  );
  job.status = "finished";
  job.changed();
  return updatedAlbums;
}

async function renameAlbumJob(job: Job): Promise<Album[]> {
  const undoDeleteAlbumPayload = {
    source: {} as Album,
    name: "",
    noUndo: true,
  };

  // rename album
  job.status = "started";
  const updatedAlbums: Album[] = [];
  const source = job.data.source as Album;
  const newName = job.data.name as string;
  undoDeleteAlbumPayload.name = source.name;

  job.progress.start = 1;
  job.progress.remaining = 1;
  job.changed();

  const targetAlbum = { ...source };
  targetAlbum.name = newName;
  const newPath = source.key.split(sep);
  newPath.pop();
  newPath.push(newName);
  targetAlbum.key = newPath.join(sep);

  try {
    await rename(
      join(imagesRoot, source.key),
      join(imagesRoot, targetAlbum.key)
    );
    undoDeleteAlbumPayload.source = targetAlbum;
    albumChanged(source, updatedAlbums);
    albumChanged(targetAlbum, updatedAlbums);
  } catch (e: any) {
    job.errors.push(e.message as string);
  } finally {
    job.progress.remaining--;
    job.changed();
  }
  if (!job.data.noUndo) {
    addToUndo(
      JOBNAMES.RENAME_ALBUM,
      `Rename album ${targetAlbum.name} back to ${source.name}`,
      undoDeleteAlbumPayload
    );
  }
  job.status = "finished";
  job.changed();
  return updatedAlbums;
}

async function restoreJob(job: Job): Promise<Album[]> {
  // Restoring a set of images means renaming them
  job.status = "started";
  const updatedAlbums: Album[] = [];
  const source = job.data.source as AlbumEntry[];
  const steps = source.length;
  job.progress.start = steps;
  job.progress.remaining = steps;
  job.changed();
  await Promise.allSettled(
    source.map(async (s) => {
      try {
        if (!s.name.startsWith(".")) {
          throw new Error(`${s.name} is not a deleted file`);
        }
        const from = join(imagesRoot, s.album.key, s.name);
        const to = join(imagesRoot, s.album.key, s.name.substr(1));
        await rename(from, to);
        albumChanged(s.album, updatedAlbums);
      } catch (e: any) {
        job.errors.push(e.message as string);
      } finally {
        job.progress.remaining--;
        job.changed();
      }
    })
  );
  job.status = "finished";
  job.changed();
  return updatedAlbums;
}

async function restoreAlbumJob(job: Job): Promise<Album[]> {
  // Restoring a set of images means renaming them
  job.status = "started";
  const updatedAlbums: Album[] = [];
  const source = job.data.source as Album;
  const steps = 1;
  job.progress.start = steps;
  job.progress.remaining = steps;
  job.changed();
  try {
    const from = join(imagesRoot, source.key);
    if (!basename(source.key).startsWith(".")) {
      throw new Error(`${source.name} is not a deleted file`);
    }
    const newKey = join(dirname(source.key), basename(source.key).substr(1));
    const to = join(imagesRoot, newKey);
    await rename(from, to);
    albumChanged({ name: source.name, key: newKey }, updatedAlbums);
  } catch (e: any) {
    job.errors.push(e.message as string);
  } finally {
    job.progress.remaining--;
    job.changed();
  }
  job.status = "finished";
  job.changed();
  return updatedAlbums;
}

async function deleteJob(job: Job): Promise<Album[]> {
  const undoDeletePayload = {
    source: [] as AlbumEntry[],
    noUndo: true,
  };

  // Deleting a set of images means renaming them
  job.status = "started";
  const updatedAlbums: Album[] = [];
  const source = job.data.source as AlbumEntry[];
  const steps = source.length;
  job.progress.start = steps;
  job.progress.remaining = steps;
  job.changed();
  await Promise.allSettled(
    source.map(async (s) => {
      try {
        const from = join(imagesRoot, s.album.key, s.name);
        const to = join(imagesRoot, s.album.key, "." + s.name);
        await rename(from, to);
        undoDeletePayload.source.push({ album: s.album, name: "." + s.name });
        albumChanged(s.album, updatedAlbums);
      } catch (e: any) {
        job.errors.push(e.message as string);
      } finally {
        job.progress.remaining--;
        job.changed();
      }
    })
  );
  addToUndo(
    JOBNAMES.RESTORE,
    `Delete ${source.length} files...`,
    undoDeletePayload
  );
  job.status = "finished";
  job.changed();
  return updatedAlbums;
}

async function multiMoveJob(job: Job): Promise<Album[]> {
  const undoMultiMovePayload = {
    source: [] as MultiMoveJobArguments,
    noUndo: false,
  };

  job.status = "started";
  const updatedAlbums: Album[] = [];
  const source = job.data.source as {source: AlbumEntry, destination: Album, rank: Number}[];
  const steps = source.length;
  job.progress.start = steps;
  job.progress.remaining = steps;
  job.changed();
  await Promise.allSettled(
    source.map(async (s, index) => {
      try {
        let targetName = s.source.name;
        const sourceRank = parseInt((await readPicasaEntry(s.source)).rank || '0');
        if(s.destination.key !== s.source.album.key) {
          let found = false;
          let destPath = join(imagesRoot, s.destination.key, targetName);
          let idx = 1;
          while (!found) {
            found = true;
            await stat(destPath)
              .then((e) => {
                // target already exists
                found = false;
                const ext = extname(s.source.name);
                const base = basename(s.source.name, ext);
                targetName = base + ` (${idx++})` + ext;
                destPath = join(imagesRoot, s.destination.key, targetName);
              })
              .catch((e) => {});
          }
          await copyMetadata(s.source, { album: s.destination, name: targetName }, true);
          await rename(
            join(imagesRoot, s.source.album.key, s.source.name),
            join(imagesRoot, s.destination.key, targetName)
          );
          undoMultiMovePayload.source.push({source: {
            album:  s.destination,
            name: targetName,
          }, destination: s.source.album, rank:sourceRank} );
        }
        await setRank({ album: s.destination, name: targetName }, s.rank);
        albumChanged(s.source.album, updatedAlbums);
        if(s.source.album.key !== s.destination.key)
          albumChanged(s.destination, updatedAlbums);

      } catch (e: any) {
        job.errors.push(e.message as string);
      } finally {
        job.progress.remaining--;
      }
    })
  );
  if (!job.data.noUndo) {
    undoMultiMovePayload.noUndo = true;
    addToUndo(
      JOBNAMES.MULTI_MOVE,
      `Move ${source.length} files to ${source[0].destination.name}...`,
      undoMultiMovePayload
    );
  }
  job.status = "finished";
  job.changed();
  return updatedAlbums;
}

async function exportJob(job: Job): Promise<Album[]> {
  // Deleting a set of images means renaming them
  job.status = "started";

  const source = job.data.source as AlbumEntry[];
  const steps = source.length;
  job.progress.start = steps;
  job.progress.remaining = steps;
  job.changed();
  const targetFolder = join(
    exportsRoot,
    "exports-" + new Date().toLocaleString().replace(/\//g, "-")
  );
  await mkdir(targetFolder, { recursive: true });
  for (const src of source) {
    try {
      await exportToFolder(src, targetFolder);
    } catch (e: any) {
      job.errors.push(e.message as string);
    } finally {
      job.progress.remaining--;
      job.changed();
    }
  }
  job.status = "finished";
  job.changed();

  openExplorer(targetFolder);
  return [];
}

async function copyMetadata(
  source: AlbumEntry,
  dest: AlbumEntry,
  deleteSource: boolean = false
) {
  const sourceIniData = await readPicasaIni(source.album);
  if (sourceIniData[source.name]) {
    updatePicasaEntry(dest, "*", sourceIniData[source.name]);

    if (deleteSource) {
      delete sourceIniData[source.name];
      updatePicasaEntry(source, "*", undefined);
    }
  }

  await copyThumbnails(source, dest, deleteSource);
}
