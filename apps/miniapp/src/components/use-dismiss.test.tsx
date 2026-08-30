import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDismiss } from './use-dismiss.js';

let container: HTMLDivElement;
let root: Root;
let closed: number;

function Menu({ open }: { open: boolean }) {
  const { ref, trigger } = useDismiss<HTMLDivElement, HTMLButtonElement>(open, () => {
    closed += 1;
  });
  return (
    <div>
      <button ref={trigger} type="button" id="trigger" />
      {open ? (
        <div ref={ref} id="menu">
          <button type="button" id="inside" />
        </div>
      ) : null}
      <button type="button" id="outside" />
    </div>
  );
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  closed = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function tap(id: string): void {
  act(() => {
    container
      .querySelector(`#${id}`)
      ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
}

describe('closing an open menu', () => {
  it('closes on a tap anywhere outside it', () => {
    act(() => root.render(<Menu open />));
    tap('outside');
    expect(closed).toBe(1);
  });

  it('stays open for a tap inside it, and for the button that opened it', () => {
    // The trigger toggles: closing here would let its own click reopen the menu,
    // which is what made it impossible to close by any other means.
    act(() => root.render(<Menu open />));
    tap('inside');
    tap('trigger');
    expect(closed).toBe(0);
  });

  it('closes on Escape, and listens for nothing while it is shut', () => {
    act(() => root.render(<Menu open />));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(closed).toBe(1);

    act(() => root.render(<Menu open={false} />));
    tap('outside');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(closed).toBe(1);
  });
});
