import { Emitter } from '../core/Emitter';

interface ContactEvents {
  /** Something landed on, brushed past or pushed off the sill at screen x (CSS px), this hard (0..1). */
  contact: { x: number; strength: number };
}

/** Bumps on the sill (a bird landing, the cat brushing by), for the things standing on it to feel. */
class SillContacts extends Emitter<ContactEvents> {
  touch(x: number, strength: number): void {
    this.emit('contact', { x, strength });
  }
}

export const sillContacts = new SillContacts();
