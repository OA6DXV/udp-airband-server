'use strict';

function createAdpcmPacer(options) {
  const {
    deliver,
    frameMs,
    maxQueueMs = 500,
    now = Date.now,
    onDrop = () => {},
    setTimer = setTimeout,
  } = options;
  const states = new WeakMap();
  const maxQueuedFrames = Math.max(1, Math.ceil(maxQueueMs / frameMs));

  function enqueue(stream, frames) {
    if (!frames.length) return;
    const state = getState(stream);
    const wasIdle = state.timer === null && state.queue.length === 0;
    state.queue.push(...frames);
    if (wasIdle) deliverNext(stream, state);
    if (state.queue.length > maxQueuedFrames) {
      const dropped = state.queue.splice(0, state.queue.length - maxQueuedFrames);
      onDrop(stream, dropped);
    }
  }

  function deliverNext(stream, state) {
    state.timer = null;
    const frame = state.queue.shift();
    if (frame === undefined) {
      state.nextAt = 0;
      return;
    }

    deliver(stream, frame);
    if (state.queue.length === 0) {
      state.nextAt = 0;
      return;
    }

    const currentTime = now();
    const idealNextAt = state.nextAt > 0 ? state.nextAt + frameMs : currentTime + frameMs;
    const idealDelay = idealNextAt - currentTime;
    const delay = idealDelay <= 0
      ? frameMs
      : Math.max(frameMs / 2, Math.min(frameMs, idealDelay));
    state.nextAt = currentTime + delay;
    state.timer = setTimer(() => deliverNext(stream, state), delay);
  }

  function getState(stream) {
    let state = states.get(stream);
    if (!state) {
      state = { queue: [], timer: null, nextAt: 0 };
      states.set(stream, state);
    }
    return state;
  }

  return { enqueue };
}

module.exports = { createAdpcmPacer };
