#include <node_api.h>
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

/* Keep the addon independent of libopus headers; libopus.so.0 is loaded at runtime. */
typedef struct OpusEncoder OpusEncoder;
typedef OpusEncoder *(*opus_create_fn)(int32_t, int, int, int *);
typedef void (*opus_destroy_fn)(OpusEncoder *);
typedef int (*opus_encode_float_fn)(OpusEncoder *, const float *, int, unsigned char *, int32_t);
typedef int (*opus_ctl_fn)(OpusEncoder *, int, ...);

typedef struct {
  void *library;
  OpusEncoder *encoder;
  opus_destroy_fn destroy;
  opus_encode_float_fn encode_float;
  int sample_rate;
  int channels;
} NativeEncoder;

static void close_encoder(NativeEncoder *state) {
  if (!state) return;
  if (state->encoder) state->destroy(state->encoder);
  if (state->library) dlclose(state->library);
  state->encoder = NULL;
  state->library = NULL;
}

static void finalize_encoder(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  NativeEncoder *state = (NativeEncoder *)data;
  close_encoder(state);
  free(state);
}

static napi_value throw_error(napi_env env, const char *message) {
  napi_throw_error(env, NULL, message);
  return NULL;
}

static napi_value close_method(napi_env env, napi_callback_info info) {
  napi_value self;
  if (napi_get_cb_info(env, info, NULL, NULL, &self, NULL) != napi_ok) return throw_error(env, "Invalid Opus encoder call");
  NativeEncoder *state = NULL;
  if (napi_unwrap(env, self, (void **)&state) != napi_ok || !state) return throw_error(env, "Invalid Opus encoder");
  close_encoder(state);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value encode_method(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1], self;
  if (napi_get_cb_info(env, info, &argc, argv, &self, NULL) != napi_ok || argc != 1) {
    return throw_error(env, "encode() requires a Float32 PCM Buffer");
  }
  NativeEncoder *state = NULL;
  if (napi_unwrap(env, self, (void **)&state) != napi_ok || !state || !state->encoder) {
    return throw_error(env, "Opus encoder is closed");
  }
  bool is_buffer = false;
  if (napi_is_buffer(env, argv[0], &is_buffer) != napi_ok || !is_buffer) {
    return throw_error(env, "Opus input must be a Buffer of interleaved Float32 samples");
  }
  void *input = NULL;
  size_t input_bytes = 0;
  if (napi_get_buffer_info(env, argv[0], &input, &input_bytes) != napi_ok) return throw_error(env, "Invalid PCM buffer");
  size_t expected_bytes = (size_t)(state->sample_rate / 50) * (size_t)state->channels * sizeof(float);
  if (input_bytes != expected_bytes) return throw_error(env, "Opus requires exactly 20 ms of Float32 PCM");

  unsigned char packet[4000];
  int written = state->encode_float(state->encoder, (const float *)input, state->sample_rate / 50, packet, sizeof(packet));
  if (written < 0) {
    char message[96];
    snprintf(message, sizeof(message), "opus_encode_float failed: %d", written);
    return throw_error(env, message);
  }
  napi_value result;
  if (napi_create_buffer_copy(env, (size_t)written, packet, NULL, &result) != napi_ok) return throw_error(env, "Could not allocate Opus packet");
  return result;
}

static napi_value create_encoder(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 3) {
    return throw_error(env, "createEncoder(sampleRate, channels, bitrate) requires three arguments");
  }
  int32_t rate, channels, bitrate;
  if (napi_get_value_int32(env, argv[0], &rate) != napi_ok ||
      napi_get_value_int32(env, argv[1], &channels) != napi_ok ||
      napi_get_value_int32(env, argv[2], &bitrate) != napi_ok ||
      (rate != 8000 && rate != 16000) || channels != 1 || bitrate < 6000 || bitrate > 128000) {
    return throw_error(env, "Opus requires mono, 8000 or 16000 Hz, and bitrate 6000-128000 bps");
  }
  NativeEncoder *state = (NativeEncoder *)calloc(1, sizeof(NativeEncoder));
  if (!state) return throw_error(env, "Could not allocate Opus encoder");
  state->library = dlopen("libopus.so.0", RTLD_NOW | RTLD_LOCAL);
  if (!state->library) {
    free(state);
    return throw_error(env, "libopus.so.0 is unavailable; install libopus0");
  }
  opus_create_fn create = (opus_create_fn)dlsym(state->library, "opus_encoder_create");
  state->destroy = (opus_destroy_fn)dlsym(state->library, "opus_encoder_destroy");
  state->encode_float = (opus_encode_float_fn)dlsym(state->library, "opus_encode_float");
  opus_ctl_fn control = (opus_ctl_fn)dlsym(state->library, "opus_encoder_ctl");
  if (!create || !state->destroy || !state->encode_float || !control) {
    close_encoder(state);
    free(state);
    return throw_error(env, "libopus is missing required encoder symbols");
  }
  int error = 0;
  state->encoder = create(rate, channels, 2048 /* OPUS_APPLICATION_VOIP */, &error);
  if (!state->encoder || error != 0 || control(state->encoder, 4002 /* OPUS_SET_BITRATE */, bitrate) != 0) {
    close_encoder(state);
    free(state);
    return throw_error(env, "Could not configure libopus encoder");
  }
  state->sample_rate = rate;
  state->channels = channels;
  napi_value result, encode_fn, close_fn;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_function(env, "encode", NAPI_AUTO_LENGTH, encode_method, NULL, &encode_fn) != napi_ok ||
      napi_create_function(env, "close", NAPI_AUTO_LENGTH, close_method, NULL, &close_fn) != napi_ok ||
      napi_set_named_property(env, result, "encode", encode_fn) != napi_ok ||
      napi_set_named_property(env, result, "close", close_fn) != napi_ok ||
      napi_wrap(env, result, state, finalize_encoder, NULL, NULL) != napi_ok) {
    close_encoder(state);
    free(state);
    return throw_error(env, "Could not expose libopus encoder");
  }
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value create_fn;
  if (napi_create_function(env, "createEncoder", NAPI_AUTO_LENGTH, create_encoder, NULL, &create_fn) != napi_ok ||
      napi_set_named_property(env, exports, "createEncoder", create_fn) != napi_ok) {
    return throw_error(env, "Could not initialize libopus addon");
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
