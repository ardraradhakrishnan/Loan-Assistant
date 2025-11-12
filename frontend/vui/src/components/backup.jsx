// import React, { useState, useRef, useEffect } from "react";
// import micImg from "../assets/mic.svg";

// export default function MicSection({ addConversation, conversation = [] }) {
//   const [isRecording, setIsRecording] = useState(false);
//   const [audioLevel, setAudioLevel] = useState(0);
//   const [audioDebug, setAudioDebug] = useState("");
//   const wsRef = useRef(null);
//   const audioContextRef = useRef(null);
//   const sourceRef = useRef(null);
//   const processorRef = useRef(null);
//   const streamRef = useRef(null);

//   const handleMicClick = async () => {
//     if (!isRecording) {
//       try {
//         await startRealtimeStreaming();
//         setIsRecording(true);
//       } catch (err) {
//         console.error("Realtime streaming start failed:", err);
//         setIsRecording(false);
//       }
//     } else {
//       await stopRealtimeStreaming();
//       setIsRecording(false);
//     }
//   };

//   const getWsUrl = () => "ws://localhost:8000/realtime/ws/realtime";

//   function floatTo16BitPCM(float32Array) {
//     const int16Array = new Int16Array(float32Array.length);
//     for (let i = 0; i < float32Array.length; i++) {
//       const s = Math.max(-1, Math.min(1, float32Array[i]));
//       int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
//     }
//     return int16Array.buffer;
//   }

//   function downsampleBuffer(buffer, originalSampleRate, targetSampleRate) {
//     if (targetSampleRate === originalSampleRate) return buffer;
//     const ratio = originalSampleRate / targetSampleRate;
//     const newLength = Math.round(buffer.length / ratio);
//     const result = new Float32Array(newLength);
//     let offsetResult = 0;
//     let offsetBuffer = 0;
//     while (offsetResult < result.length) {
//       const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
//       let accum = 0, count = 0;
//       for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
//         accum += buffer[i];
//         count++;
//       }
//       result[offsetResult] = accum / count;
//       offsetResult++;
//       offsetBuffer = nextOffsetBuffer;
//     }
//     return result;
//   }

//   function analyzeAudio(float32Array) {
//     let sum = 0, max = 0, aboveThreshold = 0;
//     const threshold = 0.03;
//     for (let i = 0; i < float32Array.length; i++) {
//       const absVal = Math.abs(float32Array[i]);
//       sum += absVal;
//       max = Math.max(max, absVal);
//       if (absVal > threshold) aboveThreshold++;
//     }
//     const avg = sum / float32Array.length;
//     const speechRatio = aboveThreshold / float32Array.length;
//     const level = Math.min(100, Math.round(avg * 1000));
//     const hasSpeech = avg > 0.008 || max > 0.08 || speechRatio > 0.1;
//     return { level, avg, max, speechRatio, hasSpeech };
//   }

//   async function startRealtimeStreaming() {
//     const wsUrl = getWsUrl();
//     const ws = new WebSocket(wsUrl);
//     wsRef.current = ws;

//     ws.onopen = () => {
//       console.info("✅ WebSocket connected");
//       setAudioDebug("✅ WebSocket connected");

//       const config = {
//         type: "config",
//         sample_rate: 16000,
//         channels: 1,
//         encoding: "linear16", // Fixed encoding for Deepgram
//       };
//       ws.send(JSON.stringify(config));
//     };

//     ws.onmessage = (evt) => {
//       if (typeof evt.data === "string") {
//         try {
//           const data = JSON.parse(evt.data);
//           if (data.type === "config_ack") {
//             console.log("✅ Config acknowledged, starting audio...");
//             setAudioDebug(prev => prev + "\n✅ Config acknowledged, starting audio...");
//             startAudioCapture(ws);
//           } else if (data.type === "transcript" && data.text) {
//             const cleanText = data.text.trim();
//             if (cleanText.length > 0) {
//               addConversation({ from: "user", text: cleanText });
//               setAudioDebug(prev => prev + `\n💬 Transcript: "${cleanText}"`);
//             }
//           }
//         } catch (err) {
//           console.warn("Failed to parse message:", err);
//         }
//       }
//     };

//     ws.onclose = (e) => {
//       console.log("🔴 WebSocket closed:", e.code, e.reason);
//       setIsRecording(false);
//       cleanupAudio();
//       setAudioDebug(prev => prev + `\n🔴 WebSocket closed`);
//     };

//     ws.onerror = (e) => {
//       console.error("🔴 WebSocket error:", e);
//       setIsRecording(false);
//       cleanupAudio();
//       setAudioDebug(prev => prev + "\n🔴 WebSocket error");
//     };
//   }

//   async function startAudioCapture(ws) {
//     try {
//       const stream = await navigator.mediaDevices.getUserMedia({
//         audio: {
//           channelCount: 1,
//           echoCancellation: false,
//           noiseSuppression: false,
//           autoGainControl: false,
//           sampleRate: 16000
//         }
//       });
//       streamRef.current = stream;

//       const audioSettings = stream.getAudioTracks()[0].getSettings();
//       const actualSampleRate = audioSettings.sampleRate || 48000;

//       const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
//         sampleRate: actualSampleRate,
//         latencyHint: "interactive"
//       });
//       audioContextRef.current = audioCtx;

//       const source = audioCtx.createMediaStreamSource(stream);
//       sourceRef.current = source;

//       const bufferSize = 1024;
//       const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
//       processorRef.current = processor;

//       let audioBuffer = [];

//       processor.onaudioprocess = (e) => {
//         if (ws.readyState !== WebSocket.OPEN) return;

//         const inputData = e.inputBuffer.getChannelData(0);
//         const analysis = analyzeAudio(inputData);
//         setAudioLevel(analysis.level);

//         // Collect chunks for ~0.5 sec
//         audioBuffer.push(new Float32Array(inputData));
//         const totalLength = audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
//         if (totalLength >= 16000 / 2) { // ~0.5s at 16kHz
//           const combinedData = new Float32Array(totalLength);
//           let offset = 0;
//           audioBuffer.forEach(arr => {
//             combinedData.set(arr, offset);
//             offset += arr.length;
//           });

//           const resampled = downsampleBuffer(combinedData, actualSampleRate, 16000);
//           const pcm16 = floatTo16BitPCM(resampled);
//           ws.send(pcm16);

//           audioBuffer = [];
//         }
//       };

//       source.connect(processor);
//       processor.connect(audioCtx.destination);

//       console.log("🎙️ Audio streaming started");
//       setAudioDebug(prev => prev + "\n🎙️ Streaming STARTED - Speak naturally!");
//     } catch (err) {
//       console.error("❌ Failed to setup audio:", err);
//       setAudioDebug(prev => prev + `\n❌ Audio setup failed: ${err.message}`);
//       if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close();
//       throw err;
//     }
//   }

//   async function stopRealtimeStreaming() {
//     console.log("Stopping realtime streaming...");
//     setAudioDebug(prev => prev + "\n⏹️ Stopping...");

//     const ws = wsRef.current;
//     if (ws) {
//       try {
//         if (ws.readyState === WebSocket.OPEN) {
//           ws.send(JSON.stringify({ type: "end_of_audio" }));
//           await new Promise(resolve => setTimeout(resolve, 100));
//           ws.close();
//         }
//       } catch (e) {
//         console.warn("Error closing ws:", e);
//       }
//       wsRef.current = null;
//     }

//     cleanupAudio();
//     console.log("✅ Realtime streaming stopped");
//     setAudioDebug(prev => prev + "\n✅ Stopped");
//   }

//   function cleanupAudio() {
//     try {
//       if (processorRef.current) {
//         processorRef.current.disconnect();
//         processorRef.current = null;
//       }
//       if (sourceRef.current) {
//         sourceRef.current.disconnect();
//         sourceRef.current = null;
//       }
//       if (streamRef.current) {
//         streamRef.current.getTracks().forEach(track => track.stop());
//         streamRef.current = null;
//       }
//       if (audioContextRef.current && audioContextRef.current.state !== "closed") {
//         audioContextRef.current.close();
//         audioContextRef.current = null;
//       }
//     } catch (err) {
//       console.warn("Error during audio cleanup:", err);
//     }
//   }

//   useEffect(() => {
//     return () => {
//       if (isRecording) stopRealtimeStreaming();
//     };
//   }, [isRecording]);

//   return (
//     <div className="d-flex flex-column align-items-center w-100">
//       <h4>Voice Assistant</h4>

//       <div
//         className={`mic-button ${isRecording ? "mic-recording" : ""}`}
//         onClick={handleMicClick}
//         role="button"
//         aria-pressed={isRecording}
//         aria-label={isRecording ? "Stop recording" : "Start recording"}
//         style={{ cursor: "pointer" }}
//       >
//         <img src={micImg} alt="microphone" className="mic-image" />
//         <div className="waveform">
//           <span className="bar b1" />
//           <span className="bar b2" />
//           <span className="bar b3" />
//           <span className="bar b4" />
//           <span className="bar b5" />
//         </div>
//       </div>

//       {isRecording && (
//         <div className="mt-2 text-center">
//           <div className="progress" style={{ width: "200px", height: "10px" }}>
//             <div
//               className={`progress-bar ${
//                 audioLevel > 20 ? "bg-success" :
//                 audioLevel > 10 ? "bg-warning" : "bg-danger"
//               }`}
//               role="progressbar"
//               style={{ width: `${audioLevel}%` }}
//               aria-valuenow={audioLevel}
//               aria-valuemin="0"
//               aria-valuemax="100"
//             ></div>
//           </div>
//           <small>Audio level: {audioLevel}</small>
//         </div>
//       )}

//       <pre className="debug mt-3">{audioDebug}</pre>
//     </div>
//   );
// }
