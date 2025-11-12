// class PCMProcessor extends AudioWorkletProcessor {
//   constructor() {
//     super();
//   }

//   process(inputs, outputs, parameters) {
//     const input = inputs[0];
//     if (input && input[0]) {
//       const channelData = input[0];
//       // Copy samples so we can transfer the underlying buffer
//       const floatBuffer = new Float32Array(channelData.length);
//       floatBuffer.set(channelData);
//       // Post message with transferable buffer for minimal copy
//       this.port.postMessage({ buffer: floatBuffer.buffer }, [floatBuffer.buffer]);
//     }
//     return true;
//   }
// }

// registerProcessor('pcm-processor', PCMProcessor);

class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const buffer = input[0];
      this.port.postMessage({ buffer });
    }
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);

