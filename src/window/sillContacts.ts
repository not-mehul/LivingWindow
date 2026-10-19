import { Emitter } from '../core/Emitter';

interface ContactEvents {
  /** Something landed on, brushed past or pushed off the sill at screen x (CSS px), this hard (0..1). */
  contact: { x: number; strength: number };
  /** A bird splashing in the puddle on the sill, at screen x. */
  splash: { x: number };
}

/** Bumps on the sill (a bird landing, the cat brushing by), for the things standing on it to feel. */
class SillContacts extends Emitter<ContactEvents> {
  touch(x: number, strength: number): void {
    this.emit('contact', { x, strength });
  }

  splash(x: number): void {
    this.emit('splash', { x });
  }
}

export const sillContacts = new SillContacts();
