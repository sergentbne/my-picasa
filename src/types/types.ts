import { Emitter } from "../lib/event.js";

export type PicasaFileMeta = {
  star?: boolean;
  rotate?: string; // f.e. rotate(angle)
  faces?: string; // f.e. rect64(5a6b0000c28ab778),42d7ff00b9602bb9
  crop?: string; // f.e. rect64(5a491bc4dd659056)
  filters?: string; // crop64=1,5a491bc4dd659056;enhance=1;finetune2=1,0.000000,0.000000,0.190877,00000000,0.000000;autolight=1;tilt=1,-0.233232,0.000000;crop64=1,1ef60000fe77df8d;fill=1,0.448598;autolight=1;fill=1,0.177570;finetune2=1,0.000000,0.000000,0.235789,00000000,0.000000;
};

export type ThumbnailSize = "th-small" | "th-medium" | "th-large";
export type ImageFileMeta = {
  [k in keyof ThumbnailSize]?: string ;
};

export type PicasaFolderMeta = {
  [name: string]: PicasaFileMeta;
};
export type ImageFolderMeta = {
  [name: string]: ImageFileMeta;
};

export type CropToolEvent = {
  cropped: {
    topLeft: { x: number; y: number };
    bottomRight: { x: number; y: number };
  };
};

export type ActiveImageEvent = {
  changed: { name: string }
};

export type SliderEvent = {
  value: number;
};

export type PanZoomEvent = {
  pan: {};
  zoom: {};
};

export type ImageControllerEvent = {
  operationListChanged: {};
  cropEdit: {};
  rotateEdit: {};
};

export type AlbumListEvent = {
  selected?: { folder: Folder; index: number };
};
export type AlbumListEventSource = Emitter<AlbumListEvent>;

export type Sortable = {
  key: string;
  name: string;
};

export type FolderEntry = {
  name: string,
  handle: any
};

export type Folder = Sortable & {
  ttl: Date;
  name: string;
  handle: any;
  videos: FolderEntry[];
  pictures: FolderEntry[];
};

export type FolderInfo = { picasa: PicasaFolderMeta; image: ImageFolderMeta };
export type FolderEvent = {
  added: { folder: Folder; index: number; list: Array<Folder> };
  updated: { folder: Folder; index: number; list: Array<Folder> };
  removed: { folder: Folder; index: number; list: Array<Folder> };
};