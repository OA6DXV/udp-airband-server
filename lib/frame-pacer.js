'use strict';

function createFramePacer(options) {
  const {
    deliver,
    frameMs,
    clearTimer = clearTimeout,
    maxQueueMs = 200,
    now = Date.now,
    onDrop = () => {},
    setTimer = setTimeout,
  } = options;
  if (!Number.isInteger(frameMs) || frameMs < 5 || frameMs > 120) {
    throw new RangeError('frameMs must be an integer between 5 and 120');
  }
  const states = new WeakMap();
  const maxQueuedFrames = Math.max(1, Math.ceil(maxQueueMs / frameMs));

  function enqueue(stream, frames) {
    if (!frames.length) return;
    const state = getState(stream);
    state.queue.push(...frames);
    if (state.queue.length > maxQueuedFrames) {
      const dropped = state.queue.splice(0, state.queue.length - maxQueuedFrames);
      onDrop(stream, dropped);
    }
    if (state.timer === null) scheduleNext(stream, state);
  }

  function scheduleNext(stream, state) {
    if (!state.queue.length) return;
    const delay = Math.max(0, state.nextAt - now());
    if (delay > 0) {
      state.timer = setTimer(() => deliverNext(stream, state), delay);
      return;
    }
    deliverNext(stream, state);
  }

  function deliverNext(stream, state) {
    state.timer = null;
    const frame = state.queue.shift();
    if (frame === undefined) return;

    deliver(stream, frame);
    // Keep the media clock anchored: timer rounding must not accumulate on
    // every frame. Limit catch-up after a stall to one frame.
    state.nextAt = Math.max(state.nextAt || now(), now() - frameMs) + frameMs;
    scheduleNext(stream, state);
  }

  function getState(stream) {
    let state = states.get(stream);
    if (!state) {
      state = { queue: [], timer: null, nextAt: 0 };
      states.set(stream, state);
    }
    return state;
  }

  function reset(stream) {
    const state = states.get(stream);
    if (!state) return;
    if (state.timer !== null) clearTimer(state.timer);
    states.delete(stream);
  }

  function isIdle(stream) {
    const state = states.get(stream);
    return !state || (!state.queue.length && state.timer === null && state.nextAt <= now());
  }

  return { enqueue, isIdle, reset };
}

module.exports = { createFramePacer };
