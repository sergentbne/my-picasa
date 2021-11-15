
/* This file is automatically generated, do not edit it */
/* This file is generated from the template located here : /Users/turpauj/dev/my-picasa/dist/server/rpc */
/* Generation date : 2021-11-15T16:28:37.920Z */
export enum Exceptions {  NotAtTip = "NotAtTip",
  ShaNotInBranch = "ShaNotInBranch",
  NotInitialized = "NotInitialized",
  NotAKey = "NotAKey",
  TagNotFound = "TagNotFound",
  TagAlreadyExists = "TagAlreadyExists",
  FailedPublishAndTag = "FailedPublishAndTag",
  FailedResetStream = "FailedResetStream",
}

export class MyPicasa {
  private socket_?: any;
  async initialize(socket: any): Promise<void> {
    this.socket_ = socket;
  }

  public on(event: string, cb: Function):void {
    this.socket_.on(event, cb);
  }

  // @ts-ignore
  private async emitNoPayload(command: string, payload: any): Promise<void> {
    return this.emit(command, payload);
  }

  private async emit(command: string, payload: any): Promise<any> {
    return new Promise((resolve, reject) =>
      this.socket_.emit(command, payload, (error:string, response:string) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      })
    );
  }

  async buildContext(entry: object):Promise<any> {
    return this.emit('MyPicasa:buildContext', {
      'args': { entry } 
    });
  }
  async cloneContext(context: string):Promise<any> {
    return this.emit('MyPicasa:cloneContext', {
      'args': { context } 
    });
  }
  async destroyContext(context: string):Promise<any> {
    return this.emit('MyPicasa:destroyContext', {
      'args': { context } 
    });
  }
  async transform(context: string, operations: string):Promise<any> {
    return this.emit('MyPicasa:transform', {
      'args': { context, operations } 
    });
  }
  async setOptions(context: string, options: object):Promise<any> {
    return this.emit('MyPicasa:setOptions', {
      'args': { context, options } 
    });
  }
  async execute(context: string, operations: object):Promise<any> {
    return this.emit('MyPicasa:execute', {
      'args': { context, operations } 
    });
  }
  async commit(context: string):Promise<any> {
    return this.emit('MyPicasa:commit', {
      'args': { context } 
    });
  }
  async encode(context: string, mime: string, format: string):Promise<any> {
    return this.emit('MyPicasa:encode', {
      'args': { context, mime, format } 
    });
  }
  async getJob(hash: object):Promise<any> {
    return this.emit('MyPicasa:getJob', {
      'args': { hash } 
    });
  }
  async createJob(jobName: string, jobData: object):Promise<any> {
    return this.emit('MyPicasa:createJob', {
      'args': { jobName, jobData } 
    });
  }
  async folders():Promise<any> {
    return this.emit('MyPicasa:folders', {
      'args': {  } 
    });
  }
  async media(album: object):Promise<any> {
    return this.emit('MyPicasa:media', {
      'args': { album } 
    });
  }
  async readFileContents(file: string):Promise<any> {
    return this.emit('MyPicasa:readFileContents', {
      'args': { file } 
    });
  }
  async writeFileContents(file: string, data: string):Promise<any> {
    return this.emit('MyPicasa:writeFileContents', {
      'args': { file, data } 
    });
  }
  async folder(folder: string):Promise<any> {
    return this.emit('MyPicasa:folder', {
      'args': { folder } 
    });
  }
  async readPicasaIni(album: object):Promise<any> {
    return this.emit('MyPicasa:readPicasaIni', {
      'args': { album } 
    });
  }
  async exifData(entry: object):Promise<any> {
    return this.emit('MyPicasa:exifData', {
      'args': { entry } 
    });
  }
  async readPicasaEntry(entry: object):Promise<any> {
    return this.emit('MyPicasa:readPicasaEntry', {
      'args': { entry } 
    });
  }
  async updatePicasaEntry(entry: object, field: string, value: any):Promise<any> {
    return this.emit('MyPicasa:updatePicasaEntry', {
      'args': { entry, field, value } 
    });
  }
  async makeAlbum(name: string):Promise<any> {
    return this.emit('MyPicasa:makeAlbum', {
      'args': { name } 
    });
  }
  async readOrMakeThumbnail(entry: object, size: string):Promise<any> {
    return this.emit('MyPicasa:readOrMakeThumbnail', {
      'args': { entry, size } 
    });
  }
  async openInFinder(album: object):Promise<any> {
    return this.emit('MyPicasa:openInFinder', {
      'args': { album } 
    });
  }
}