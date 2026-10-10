{
  "targets": [
    {
      "target_name": "opus_native",
      "sources": ["native/opus_native.c"],
      "libraries": ["-ldl"],
      "cflags": ["-std=c11"]
    }
  ]
}
