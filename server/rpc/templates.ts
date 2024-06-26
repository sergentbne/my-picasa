export const TSCodeTemplate = `
/* This file is automatically generated, do not edit it */
/* This file is generated from the template located here : ${__dirname} */
<<CONSTANTS>>
export class <<CLASS>> {
  private socket_?: any;
  async initialize(socket: any): Promise<void> {
    this.socket_ = socket;
  }

  public on(event: string, cb: Function): Function {
    return this.socket_.on(event, cb);
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
<<CODE>>
}`;
