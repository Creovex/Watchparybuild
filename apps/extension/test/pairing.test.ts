import { describe, expect, it } from 'vitest';
import { PortPairing } from '../src/background/pairing';
import { FakePort } from './helpers';

describe('PortPairing', () => {
  it('tells each side whether the other is connected', () => {
    const pairing = new PortPairing<FakePort>();
    const content = new FakePort();
    const panel = new FakePort();
    pairing.connect(7, 'content', content);
    expect(content.sent).toEqual([{ type: 'peer', connected: false }]);
    pairing.connect(7, 'panel', panel);
    expect(panel.sent).toEqual([{ type: 'peer', connected: true }]);
    expect(content.last()).toEqual({ type: 'peer', connected: true });
  });

  it('relays both ways within one tab only', () => {
    const pairing = new PortPairing<FakePort>();
    const [c1, p1, c2, p2] = [new FakePort(), new FakePort(), new FakePort(), new FakePort()];
    pairing.connect(1, 'content', c1);
    pairing.connect(1, 'panel', p1);
    pairing.connect(2, 'content', c2);
    pairing.connect(2, 'panel', p2);
    expect(pairing.relay(1, 'content', c1, { type: 'ended' })).toBe(true);
    expect(pairing.relay(1, 'panel', p1, { type: 'hold' })).toBe(true);
    expect(p1.last()).toEqual({ type: 'ended' });
    expect(c1.last()).toEqual({ type: 'hold' });
    expect(p2.sent).not.toContainEqual({ type: 'ended' });
    expect(c2.sent).not.toContainEqual({ type: 'hold' });
  });

  it('does not relay when the other side is missing', () => {
    const pairing = new PortPairing<FakePort>();
    const content = new FakePort();
    pairing.connect(3, 'content', content);
    expect(pairing.relay(3, 'content', content, { type: 'ended' })).toBe(false);
  });

  it('replaces a second connection of the same kind and disconnects the first', () => {
    const pairing = new PortPairing<FakePort>();
    const oldPanel = new FakePort();
    const newPanel = new FakePort();
    const content = new FakePort();
    pairing.connect(4, 'content', content);
    pairing.connect(4, 'panel', oldPanel);
    pairing.connect(4, 'panel', newPanel);
    expect(oldPanel.disconnected).toBe(true);
    expect(pairing.get(4, 'panel')).toBe(newPanel);
    pairing.relay(4, 'content', content, { type: 'ended' });
    expect(newPanel.last()).toEqual({ type: 'ended' });
    expect(oldPanel.sent).not.toContainEqual({ type: 'ended' });
    // Messages from the replaced port are dropped.
    expect(pairing.relay(4, 'panel', oldPanel, { type: 'hold' })).toBe(false);
  });

  it('ignores a late disconnect from a replaced port', () => {
    const pairing = new PortPairing<FakePort>();
    const oldContent = new FakePort();
    const newContent = new FakePort();
    const panel = new FakePort();
    pairing.connect(5, 'panel', panel);
    pairing.connect(5, 'content', oldContent);
    pairing.connect(5, 'content', newContent);
    const before = panel.sent.length;
    pairing.disconnect(5, 'content', oldContent);
    expect(pairing.get(5, 'content')).toBe(newContent);
    expect(panel.sent.length).toBe(before);
  });

  it('tells the remaining side when its peer disconnects and forgets empty tabs', () => {
    const pairing = new PortPairing<FakePort>();
    const content = new FakePort();
    const panel = new FakePort();
    pairing.connect(6, 'content', content);
    pairing.connect(6, 'panel', panel);
    pairing.disconnect(6, 'panel', panel);
    expect(content.last()).toEqual({ type: 'peer', connected: false });
    pairing.disconnect(6, 'content', content);
    expect(pairing.size).toBe(0);
  });

  it('survives a port that throws when posted to', () => {
    const pairing = new PortPairing<FakePort>();
    const content = new FakePort();
    const panel = new FakePort();
    pairing.connect(8, 'content', content);
    pairing.connect(8, 'panel', panel);
    panel.throwOnPost = true;
    expect(pairing.relay(8, 'content', content, { type: 'ended' })).toBe(false);
    expect(pairing.send(8, 'content', { type: 'bound', bound: true })).toBe(true);
  });

  it('drops both sides when the tab closes', () => {
    const pairing = new PortPairing<FakePort>();
    pairing.connect(9, 'content', new FakePort());
    pairing.removeTab(9);
    expect(pairing.get(9, 'content')).toBeUndefined();
  });
});
