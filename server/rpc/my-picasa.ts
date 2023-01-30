/* eslint-disable @typescript-eslint/camelcase */
import { Exceptions } from "../../shared/types/exceptions";
import { undo, undoList } from "../utils/undo";
import { getFilterGroups, getFilterList } from "./imageOperations/imageFilters";
import { imageInfo } from "./imageOperations/info";
import {
  buildContext,
  cloneContext,
  commit,
  destroyContext,
  encode,
  execute,
  setOptions,
  transform
} from "./imageOperations/sharp-processor";
import { clientException, clientLog } from "./rpcFunctions/clientLog";
import { exifData } from "./rpcFunctions/exif";
import { createFSJob, getJob, waitJob } from "./rpcFunctions/fileJobs";
import {
  folder,
  makeAlbum,
  openAlbumEntryInFinder,
  openAlbumInFinder,
  readFileContents,
  writeFileContents
} from "./rpcFunctions/fs";
import { media, mediaCount, setRank, sortAlbum } from "./rpcFunctions/media";
import {
  getFaceAlbumFromHash,
  getShortcuts, readPicasaEntry, rotate,
  toggleStar,
  updatePicasaEntry
} from "./rpcFunctions/picasaIni";
import { clientReady } from "./rpcFunctions/ready";
import { folders, getSourceEntry, monitorAlbums, readAlbumMetadata, setAlbumShortcut } from "./rpcFunctions/walker";
import { ServiceMap } from "./rpcHandler";

/**
 * ConcurrencyService IDL
 */
export const MyPicasa: ServiceMap = {
  name: "MyPicasa",
  constants: {
    Exceptions,
  },
  functions: {
    buildContext: {
      handler: buildContext,
      arguments: ["entry:object"],
    },
    cloneContext: {
      handler: cloneContext,
      arguments: ["context:string", "hint:string"],
    },
    destroyContext: {
      handler: destroyContext,
      arguments: ["context:string"],
    },
    transform: {
      handler: transform,
      arguments: ["context:string", "operations:string"],
    },
    setOptions: {
      handler: setOptions,
      arguments: ["context:string", "options:object"],
    },
    execute: {
      handler: execute,
      arguments: ["context:string", "operations:object"],
    },
    commit: {
      handler: commit,
      arguments: ["context:string"],
    },
    encode: {
      handler: encode,
      arguments: ["context:string", "mime:string", "format:string"],
    },
    getJob: {
      handler: getJob,
      arguments: ["hash:string"],
    },
    waitJob: {
      handler: waitJob,
      arguments: ["hash:string"],
    },
    createJob: {
      handler: createFSJob,
      arguments: ["jobName:string", "jobData:object"],
    },
    folders: {
      handler: folders,
      arguments: ["filter:string"],
    },
    monitorAlbums: {
      handler: monitorAlbums,
      arguments: [],
    },
    media: {
      handler: media,
      arguments: ["album:object"],
    },
    mediaCount: {
      handler: mediaCount,
      arguments: ["album:object"],
    },
    readFileContents: {
      handler: readFileContents,
      arguments: ["file:string"],
    },
    writeFileContents: {
      handler: writeFileContents,
      arguments: ["file:string", "data:string"],
    },
    folder: {
      handler: folder,
      arguments: ["folder:string"],
    },
    sortAlbum: {
      handler: sortAlbum,
      arguments: ["album:object", "sort:string"],
    },
    setRank: {
      handler: setRank,
      arguments: ["entry:string", "rank:integer"],
    },
    readAlbumMetadata: {
      handler: readAlbumMetadata,
      arguments: ["album:object"],
    },
    exifData: {
      handler: exifData,
      arguments: ["entry:object"],
    },
    readPicasaEntry: {
      handler: readPicasaEntry,
      arguments: ["entry:object"],
    },
    updatePicasaEntry: {
      handler: updatePicasaEntry,
      arguments: ["entry:object", "field:string", "value:any"],
    },
    makeAlbum: {
      handler: makeAlbum,
      arguments: ["name:string"],
    },
    openInFinder: {
      handler: openAlbumInFinder,
      arguments: ["album:object"],
    },
    openEntryInFinder: {
      handler: openAlbumEntryInFinder,
      arguments: ["entry:object"],
    },
    undoList: {
      handler: undoList,
      arguments: [],
    },
    undo: {
      handler: undo,
      arguments: ["id:string"],
    },
    imageInfo: {
      handler: imageInfo,
      arguments: ["entry:object"],
    },
    log: {
      handler: clientLog,
      arguments: ["event:string", "data:object"],
    },
    exception: {
      handler: clientException,
      arguments: ["message:string", "file:string", "line:integer", "col:integer", "error:object"],
    },
    ready: {
      handler: clientReady,
      arguments: [],
    },
    getFilterList: {
      handler: getFilterList,
      arguments: ["group:string"],
    },
    getFilterGroups: {
      handler: getFilterGroups,
      arguments: [],
    },
    setAlbumShortcut: {
      handler: setAlbumShortcut,
      arguments: ["album:object", "shortcut:string"],
    },
    getShortcuts: {
      handler: getShortcuts,
      arguments:[]
    },
    getSourceEntry: {
      handler: getSourceEntry,
      arguments:["entry:object"]
    },
    getFaceAlbumFromHash: {
      handler: getFaceAlbumFromHash,
      arguments:["hash:string"]
    },
    rotate: {
      handler: rotate,
      arguments:["entries:object", "direction:string"]
    },
    toggleStar: {
      handler: toggleStar,
      arguments:["entries:object"]
    }
  },
};
