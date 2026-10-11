/** Fixed-capacity log: keeps the newest `capacity` entries (bounded diagnostics logging). */
export class RingLog<T> {
  private readonly items: T[] = [];

  constructor(readonly capacity: number) {
    if (!(capacity >= 1)) throw new RangeError("Capacity must be at least 1");
  }

  push(item: T) {
    this.items.push(item);
    if (this.items.length > this.capacity)
      this.items.splice(0, this.items.length - this.capacity);
  }

  toArray(): T[] {
    return [...this.items];
  }

  clear() {
    this.items.length = 0;
  }

  get size() {
    return this.items.length;
  }
}
