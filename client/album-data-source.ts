import { buildEmitter, Emitter } from "../shared/lib/event";
import {
  albumInFilter,
  debounced,
  groupBy,
  removeDiacritics,
  sortByKey,
} from "../shared/lib/utils";
import {
  Album,
  AlbumChangeEvent,
  AlbumKind,
  AlbumWithData,
  Node,
} from "../shared/types/types";
import { t } from "./components/strings";
import { getService } from "./rpc/connect";
import { AlbumListEvent } from "./uiTypes";
function firstAlbum(node: Node): AlbumWithData | undefined {
  if (node.albums.length > 0) return node.albums[0];
  if (node.childs) {
    for (const child of Object.values(node.childs)) {
      const a = firstAlbum(child);
      if (a) return a;
    }
  }
  return undefined;
}
function lastAlbum(node: Node): AlbumWithData | undefined {
  if (node.albums.length > 0) return node.albums[node.albums.length - 1];
  if (node.childs) {
    for (const child of Object.values(node.childs).reverse()) {
      const a = lastAlbum(child);
      if (a) return a;
    }
  }
  return undefined;
}
function allAlbums(node: Node): AlbumWithData[] {
  return [...node.albums, ...Object.values(node.childs).map(allAlbums).flat()];
}

export type AlbumSortOrder = "ReverseDate" | "ForwardDate";
export class AlbumIndexedDataSource {
  constructor() {
    this.albums = [];
    this.allAlbums = [];
    this.filter = null;
    this.shortcuts = {};
    this.sort = "ReverseDate";
    const albumEmitter = buildEmitter<AlbumListEvent>();
    this.emitter = albumEmitter;
  }

  async init() {
    const s = await getService();
    this.shortcuts = await s.getShortcuts();
    let invalidations: any[] = [];

    const resolveAndInvalidate = debounced(() => {
      if (invalidations.length > 0) {
        const filtered = invalidations.filter(
          (v) => v !== undefined
        ) as number[];
        if (filtered.length > 0) {
          const min = Math.min(...filtered);
          const max = Math.max(...filtered);
          if (min === max) {
            this.emitter.emit("invalidateAt", { index: min });
          } else if (min === 0 && max === this.albums.length - 1) {
            this.emitter.emit("reset", {});
          } else {
            console.warn(`Invalidating from ${min} / ${max}`);
            this.emitter.emit("invalidateFrom", {
              index: min,
              to: max,
            });
          }
        }
        invalidations = [];
      }
    });
    return new Promise<void>((resolve) => {
      s.monitorAlbums();
      let gotEvent = false;

      this.shortcutsUnreg = s.on("shortcutsUpdated", async () => {
        this.shortcuts = await s.getShortcuts();
        invalidations.push(0);
        invalidations.push(10);
        resolveAndInvalidate();
      });
      this.unreg = s.on("albumEvent", async (e: any) => {
        for (const event of e.payload as AlbumChangeEvent[]) {
          if (!gotEvent && event.type !== "albums") {
            continue;
          }
          console.log("Got event", event.type, ";", event.album?.name);
          switch (event.type) {
            case "albums":
              {
                gotEvent = true;
                this.allAlbums = event.albums!.map((a) => ({
                  ...a,
                  indent: 0,
                  collapsed: false,
                  head: [],
                }));
                this.sortFolders();
                invalidations.push(0);
                invalidations.push(this.albums.length - 1);
                resolve();
              }
              break;
            case "albumDeleted":
              invalidations.push(this.removeAlbum(event.album!));
              invalidations.push(this.albums.length - 1);
              break;
            case "albumInfoUpdated":
              {
                const up = this.updatedAlbum(event.album!, event.album!);
                if (up) {
                  invalidations.push(up.idx);
                  invalidations.push(up.idx2);
                }
              }
              break;
            case "albumOrderUpdated":
              const index = this.albumIndexFromKey(event.album!.key);
              invalidations.push(index);
              break;
            case "albumRenamed":
              {
                const up = this.updatedAlbum(event.album!, event.altAlbum!);
                if (up) {
                  invalidations.push(up.idx);
                  invalidations.push(up.idx2);
                }
              }
              break;
            case "albumAdded":
              invalidations.push(this.addAlbum(event.album!));
              invalidations.push(this.albums.length - 1);
          }
        }
        resolveAndInvalidate();
      });
    });
  }
  async destroy() {
    if (this.unreg) this.unreg();
    if (this.shortcutsUnreg) this.shortcutsUnreg();
  }

  async setFilter(filter: string) {
    this.filter = removeDiacritics(filter.toLowerCase());
    this.sortFolders();
    this.emitter.emit("invalidateFrom", {
      index: 0,
      to: this.albums.length - 1,
    });
  }

  private addAlbum(album: AlbumWithData) {
    // Find at which index the album should be added
    let index = this.allAlbums.findIndex((a) => a.key === album.key);
    if (index !== -1) {
      return;
    }
    this.allAlbums.push({ ...album });
    this.sortFolders();
    // find where the album is, and invalidate from that point
    index = this.albums.findIndex((a) => a.key === album.key);
    if (index === -1) {
      throw new Error("Album not found");
    }
    return index;
  }

  private removeAlbum(album: AlbumWithData) {
    const idx = this.albums.findIndex((a) => a.key === album.key);
    if (idx !== -1) {
      this.albums.splice(idx, 1);
      return idx;
    }
    return;
  }
  private updatedAlbum(from: AlbumWithData, to: AlbumWithData) {
    const idxAll = this.allAlbums.findIndex((a) => a.key === from.key);
    if (idxAll !== -1) {
      this.allAlbums[idxAll] = { ...this.allAlbums[idxAll], ...to };
      return { idx: idxAll, idx2: idxAll };
    }
    return;
  }

  toggleCollapse(node: Node) {
    node.collapsed = !node.collapsed;
    this.emitter.emit("invalidateFrom", {
      index: this.albumIndex(firstAlbum(node)!),
      to: this.albumIndex(lastAlbum(node)!),
    });
    this.emitter.emit("nodeChanged", { node });
  }

  isCollapsed(
    album: AlbumWithData,
    node: Node = this.hierarchy
  ): boolean | undefined {
    if (node.albums.find((a) => a.key === album.key)) {
      return node.collapsed;
    }
    if (node.childs) {
      for (const child of Object.values(node.childs)) {
        const c = this.isCollapsed(album, child);
        if (c !== undefined) {
          return c || node.collapsed;
        }
      }
    }
    return undefined;
  }

  albumAtIndex(index: number): AlbumWithData {
    if (index >= this.albums.length) {
      throw new Error("out of bounds");
    }
    return this.albums[index];
  }

  albumIndexFromKey(key: string): number {
    const idx = this.albums.findIndex((f) => f.key === key);
    if (idx === -1) {
      throw new Error("Unknown album key");
    }
    return idx;
  }

  albumIndex(album: Album): number {
    const idx = this.albums.findIndex((f) => f.key === album.key);
    if (idx === -1) {
      throw new Error("Unknown album key");
    }
    return idx;
  }

  length(): number {
    return this.albums.length;
  }

  private sortFolders() {
    const sorted = this.sortAlbums(this.allAlbums, this.filter);
    this.hierarchy = sorted.node;
    this.albums = sorted.albums;
  }

  private sortAlbums(
    albumsFromServer: AlbumWithData[],
    filter: string | null
  ): { node: Node; albums: AlbumWithData[] } {
    const filteredAlbums = albumsFromServer.filter((a) =>
      filter === null ? true : albumInFilter(a, filter)
    );
    const groups = groupBy(filteredAlbums, "kind");

    let folders = groups.get(AlbumKind.FOLDER)!;
    sortByKey(folders, ["name"], ["reverse"]);

    const shortcuts = folders.filter((a) => a.shortcut).map((f) => ({ ...f }));
    sortByKey(shortcuts, ["name"], ["alpha"]);

    const faces = groups.get(AlbumKind.FACE)!;
    sortByKey(faces, ["name"], ["alpha"]);

    const foldersByYear = groupBy(folders, "name", (n: string) =>
      n.slice(0, 4)
    );
    const hierarchy = {
      name: "",
      collapsed: false,
      albums: [],
      childs: [
        {
          name: t("shortcuts"),
          collapsed: false,
          albums: shortcuts,
          childs: [],
        },
        {
          name: t("folders"),
          albums: [],
          collapsed: false,
          childs: Array.from(foldersByYear.keys()).map((key) => ({
            name: key,
            collapsed: false,
            albums: foldersByYear.get(key)!,
            childs: [],
          })),
        },
        {
          name: t("faces"),
          collapsed: false,
          albums: faces,
          childs: [],
        },
      ],
    };
    const albums = allAlbums(hierarchy);
    return { node: hierarchy, albums };
  }

  getHierarchy(): Node {
    return this.hierarchy;
  }

  private albums: AlbumWithData[];
  private hierarchy: Node = {
    collapsed: false,
    albums: [],
    name: "",
    childs: [],
  };
  private allAlbums: AlbumWithData[];
  private filter: string | null;
  public shortcuts: { [shortcut: string]: Album };
  public emitter: Emitter<AlbumListEvent>;
  private sort: AlbumSortOrder;
  private unreg: Function | undefined;
  private shortcutsUnreg: Function | undefined;
}
