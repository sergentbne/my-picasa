export type Task = (() => PromiseLike<any>) | (() => any);

export class Queue {
  constructor(concurrency: number = 1, options?: { fifo?: boolean }) {
    this.q = [];
    this.concurrency = concurrency;
    this.active = 0;
    this.options = options || {};
  }
  add(r: Task): void {
    this.q.push(r);
    this.startIfNeeded();
  }
  async startIfNeeded() {
    while (this.active < this.concurrency) {
      if (this.q.length > 0) {
        let t;
        if (this.options.fifo) {
          t = this.q.shift();
        } else {
          t = this.q.pop();
        }
        this.active++;

        t!().finally(() => {
          this.active--;
          this.startIfNeeded();
        });
      } else {
        // starving....
        break;
      }
    }
  }
  private q: Task[];
  private concurrency: number;
  private active: number;
  private options: { fifo?: boolean };
}