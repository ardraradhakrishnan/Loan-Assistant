import React, { useState, useRef, useEffect, useCallback } from "react";
import micImg from "../assets/mic.svg";

export default function MicSection({onUserDataUpdate, onAnalysisUpdate}) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [conversation, setConversation] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const isTTSAudioPlaying = useRef(false);
  const chatBoxRef = useRef(null);

  // Improved audio queue system
  const audioQueueRef = useRef([]);
  const isAudioPlayingRef = useRef(false);
  const currentAudioSourceRef = useRef(null);
  const audioBufferQueueRef = useRef([]);
  const isNewAssistantResponse = useRef(true);
  const responseTimeoutRef = useRef(null);

  // const getWsUrl = () => "ws://localhost:8000/realtime/ws/realtime";
  const getWsUrl = () => "wss://loan-assistant-v6b5.onrender.com";

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [conversation]);

  const floatTo16BitPCM = (float32Array) => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array.buffer;
  };

  const downsampleBuffer = (buffer, originalSampleRate, targetSampleRate) => {
    if (targetSampleRate === originalSampleRate) return buffer;
    const ratio = originalSampleRate / targetSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0,
        count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  };

  const analyzeAudio = (float32Array) => {
    let sum = 0,
      max = 0,
      aboveThreshold = 0;
    const threshold = 0.01;
    for (let i = 0; i < float32Array.length; i++) {
      const absVal = Math.abs(float32Array[i]);
      sum += absVal;
      max = Math.max(max, absVal);
      if (absVal > threshold) aboveThreshold++;
    }
    const avg = sum / float32Array.length;
    const speechRatio = aboveThreshold / float32Array.length;
    const level = Math.min(100, Math.round(avg * 1000));
    const hasSpeech = avg > 0.003 || max > 0.03 || speechRatio > 0.05;
    return { level, hasSpeech };
  };

  // Improved audio playback with continuous buffer
  const playPCMAudio = async (arrayBuffer) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 24000
        });
      }

      const audioContext = audioContextRef.current;
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Convert PCM16 to Float32
      const length = arrayBuffer.byteLength / 2;
      const float32Array = new Float32Array(length);
      const view = new DataView(arrayBuffer);
      
      for (let i = 0; i < length; i++) {
        const sample = view.getInt16(i * 2, true);
        float32Array[i] = sample / 32768.0;
      }

      // Add to buffer queue
      audioBufferQueueRef.current.push(float32Array);

      // Start playback if not already playing
      if (!isAudioPlayingRef.current) {
        playContinuousAudio();
      }
      
    } catch (error) {
      console.error('❌ Audio playback error:', error);
    }
  };

  // Continuous audio playback using a single source
  const playContinuousAudio = async () => {
    if (isAudioPlayingRef.current || audioBufferQueueRef.current.length === 0) {
      return;
    }

    isAudioPlayingRef.current = true;

    try {
      while (audioBufferQueueRef.current.length > 0) {
        const float32Array = audioBufferQueueRef.current.shift();
        
        // Create audio buffer
        const audioBuffer = audioContextRef.current.createBuffer(1, float32Array.length, 24000);
        audioBuffer.getChannelData(0).set(float32Array);
        
        // Create and play source
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        currentAudioSourceRef.current = source;
        
        // Play and wait for completion
        await new Promise((resolve) => {
          source.start();
          source.onended = () => {
            resolve();
          };
          
          // Fallback timeout in case onended doesn't fire
          setTimeout(resolve, (float32Array.length / 24000) * 1000 + 50);
        });
        
        currentAudioSourceRef.current = null;
      }
    } catch (error) {
      console.error('❌ Continuous audio playback error:', error);
    }

    isAudioPlayingRef.current = false;
  };

  const cleanupAudio = useCallback(() => {
      try {
        // Clear response timeout
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current);
          responseTimeoutRef.current = null;
        }
        isNewAssistantResponse.current = true;
        
        // Stop current playback
        if (currentAudioSourceRef.current) {
          try {
            currentAudioSourceRef.current.stop();
          } catch (e) {
            // Ignore errors when stopping
          }
          currentAudioSourceRef.current = null;
        }

        // Clear queues
        audioQueueRef.current = [];
        audioBufferQueueRef.current = [];
        isAudioPlayingRef.current = false;
        
        if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
        }
        if (sourceRef.current) {
          sourceRef.current.disconnect();
          sourceRef.current = null;
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
      } catch (err) {
        console.warn("⚠️ Audio cleanup failed:", err);
      }
    }, []);


  const stopRealtimeStreaming = useCallback(async () => {
    console.log("🛑 Stopping realtime streaming...");
    setConnectionStatus("disconnected");
    
    const ws = wsRef.current;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "end_of_audio" }));
          await new Promise((r) => setTimeout(r, 100));
          ws.close();
        }
      } catch (e) {
        console.warn("⚠️ Error closing ws:", e);
      }
      wsRef.current = null;
    }
    cleanupAudio();
    console.log("✅ Streaming stopped");
  }, [cleanupAudio]);

  const startAudioCapture = useCallback(async () => {
    try {
      console.log("🎤 Requesting microphone access...");
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (!stream) {
        throw new Error("No stream returned from getUserMedia");
      }
      
      console.log("✅ Microphone access granted");
      streamRef.current = stream;

      const audioSettings = stream.getAudioTracks()[0].getSettings();
      const actualSampleRate = audioSettings.sampleRate || 48000;
      console.log("🎤 Audio settings:", audioSettings);

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: actualSampleRate,
        latencyHint: "interactive",
      });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const bufferSize = 512;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      let audioBuffer = [];
      let lastSendTime = 0;
      const minSendInterval = 50;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isTTSAudioPlaying.current) {
          setAudioLevel(0);
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        const analysis = analyzeAudio(inputData);
        setAudioLevel(analysis.level);

        audioBuffer.push(new Float32Array(inputData));
        
        const totalLength = audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
        const currentTime = Date.now();

        if (totalLength >= 1600 || (currentTime - lastSendTime >= minSendInterval && totalLength > 0)) {
          const combinedData = new Float32Array(totalLength);
          let offset = 0;
          audioBuffer.forEach((arr) => {
            combinedData.set(arr, offset);
            offset += arr.length;
          });
          
          const resampled = downsampleBuffer(combinedData, actualSampleRate, 16000);
          const pcm16 = floatTo16BitPCM(resampled);
          
          wsRef.current.send(pcm16);
          audioBuffer = [];
          lastSendTime = currentTime;
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      console.log("🎙️ Mic streaming started");
      
      return true;
    } catch (err) {
      console.error("❌ Failed to start mic:", err);
      
      if (err.name === 'NotAllowedError') {
        alert("Microphone permission was denied. Please allow microphone access and try again.");
      } else if (err.name === 'NotFoundError') {
        alert("No microphone detected. Please check your audio devices.");
      } else if (err.name === 'NotSupportedError') {
        alert("Your browser doesn't support the required audio features.");
      } else {
        alert("Failed to access microphone: " + err.message);
      }
      
      throw err;
    }
  }, []);

  const startRealtimeStreaming = useCallback(async () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log("✅ WebSocket already connected");
      return true;
    }

    return new Promise((resolve, reject) => {
      console.log("🔗 Connecting to WebSocket...");
      setConnectionStatus("connecting");

      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.info("✅ WebSocket connected");
        setConnectionStatus("connected");
        ws.send(
          JSON.stringify({
            type: "config",
            sample_rate: 16000,
            channels: 1,
            encoding: "linear16",
          })
        );
        resolve(true);
      };

      ws.onmessage = async (evt) => {
          // Handle binary audio data (Blob)
          if (evt.data instanceof Blob) {
            console.log("🔊 Received audio blob:", evt.data.size, "bytes");
            
            try {
              const arrayBuffer = await evt.data.arrayBuffer();
              await playPCMAudio(arrayBuffer);
            } catch (err) {
              console.error("❌ Failed to play audio:", err);
            }
            return;
          }

          // Handle text messages
          if (typeof evt.data !== "string") return;

          try {
            const data = JSON.parse(evt.data);

            if (data.type === "config_ack") {
              console.log("✅ Config acknowledged — starting mic stream");
              startAudioCapture().catch(err => {
                console.error("❌ Failed to start audio capture:", err);
                stopRealtimeStreaming();
              });
            }

            else if (data.type === "transcript" && data.text && data.is_final) {
              const cleanText = data.text.trim();
              if (cleanText.length > 0) {
                console.log("💬 User transcript:", cleanText);
                setConversation((prev) => {
                  // Check if the last message is from user and update it, otherwise add new
                  const lastMessage = prev[prev.length - 1];
                  if (lastMessage && lastMessage.from === "user") {
                    // Update the existing user message
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...lastMessage, text: cleanText };
                    return updated;
                  } else {
                    // Add new user message
                    return [...prev, { from: "user", text: cleanText }];
                  }
                });
              }
            }

            else if (data.type === "chat_message" && data.text) {
              const cleanText = data.text.trim();
              if (cleanText.length > 0) {
                const from = data.role === "assistant" ? "assistant" : "user";
                console.log(`💬 ${from} chat message:`, cleanText);
                
                // For user messages, always create new bubbles
                if (from === "user") {
                  setConversation((prev) => [
                    ...prev,
                    { from, text: cleanText }
                  ]);
                } else {
                  // For assistant messages, use timeout to detect response boundaries
                  
                  // Clear any existing timeout
                  if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                  }
                  
                  // Set a new timeout to detect response completion
                  responseTimeoutRef.current = setTimeout(() => {
                    isNewAssistantResponse.current = true;
                    console.log("⏰ Response completed - ready for new message");
                  }, 800); // 800ms of silence means response is complete
                  
                  setConversation((prev) => {
                    const lastMessage = prev[prev.length - 1];
                    
                    if (lastMessage && lastMessage.from === "assistant" && !isNewAssistantResponse.current) {
                      // Append to the existing assistant message
                      const updated = [...prev];
                      const currentText = lastMessage.text;
                      const newText = currentText + (currentText.length > 0 ? ' ' : '') + cleanText;
                      
                      updated[updated.length - 1] = { 
                        ...lastMessage, 
                        text: newText
                      };
                      return updated;
                    } else {
                      // Start a new assistant message
                      isNewAssistantResponse.current = false;
                      return [...prev, { from, text: cleanText }];
                    }
                  });
                }
              }
            }

            else if (data.type === "tts_start") {
              console.log("🔇 TTS playback started — pausing mic");
              isTTSAudioPlaying.current = true;
              if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => (t.enabled = false));
              }
            } else if (data.type === "tts_end") {
              console.log("🎤 TTS playback ended — resuming mic");
              isTTSAudioPlaying.current = false;
              if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => (t.enabled = true));
              }
            }

            else if (data.type === "field_extracted") {
                console.log(`📥 Field extracted: ${data.field} = ${data.value}`);
                // Update user data in parent component
                onUserDataUpdate({ [data.field]: data.value });
              }
              
              // Also keep your existing extracted_fields handler for backward compatibility
              else if (data.type === "extracted_fields") {
                console.log("📥 All fields extracted:", data.data);
                onUserDataUpdate(data.data);
              }

              else if (data.type === "loan_calculations") {
                console.log("📊 Loan calculations received:", data.data);
                onAnalysisUpdate(data.data);
              }

              // In your WebSocket message handler in MicSection.jsx
              else  if (data.type === "field_confirmed") {
                    console.log(`✅ Field confirmed: ${data.field} = ${data.value}`);
                    onUserDataUpdate({ [data.field]: data.value });
                }

              else  if (data.type === "field_pending") {
                    console.log(`⏳ Field pending confirmation: ${data.field} = ${data.value}`);
                    // You might want to handle pending fields differently
                    // For now, we'll treat them as confirmed for immediate UI update
                    onUserDataUpdate({ [data.field]: data.value });
                }

              else  if (data.type === "email_status") {
                    console.log(`📧 Email status: ${data.status} to ${data.to}`);
                    // You can show email status in UI if needed
                }

            else if (data.type === "info") {
              console.log("ℹ️ Server info:", data.message);
            }
          } catch (err) {
            console.warn("⚠️ Failed to parse message:", err);
          }
        };

      ws.onclose = (event) => {
        console.log("🔴 WebSocket closed:", event.code, event.reason);
        setConnectionStatus("disconnected");
        
        if (event.code !== 1000) {
          reject(new Error(`WebSocket closed: ${event.code} ${event.reason}`));
        }
      };

      ws.onerror = (e) => {
        console.error("🔴 WebSocket error:", e);
        setConnectionStatus("error");
        reject(new Error("WebSocket connection failed"));
      };

      // Set timeout for connection
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error("WebSocket connection timeout"));
          ws.close();
        }
      }, 5000);
    });
  }, [startAudioCapture, stopRealtimeStreaming]);

  const handleMicClick = async () => {
    if (isTTSAudioPlaying.current) {
      console.log("⏸️ TTS is playing, cannot start recording");
      return;
    }
    
    if (!isRecording) {
      try {
        console.log("🎤 Starting recording...");
        setIsRecording(true);
        
        await startRealtimeStreaming();
        console.log("✅ Recording started successfully");
        
      } catch (err) {
        console.error("❌ Failed to start recording:", err);
        alert(`Failed to start recording: ${err.message}\n\nPlease check if the server is running at ${getWsUrl()}`);
        setIsRecording(false);
      }
    } else {
      console.log("🛑 Stopping recording...");
      await stopRealtimeStreaming();
      setIsRecording(false);
    }
  };

  // Cleanup effect
  useEffect(() => {
    return () => {
      if (isRecording) stopRealtimeStreaming();
    };
  }, [isRecording, stopRealtimeStreaming]);

  return (
    <div className="d-flex flex-column align-items-center w-100 p-3">
      <h4 className="mb-3">🎙️ Voice Assistant</h4>

      <div className="mb-2">
        <small className={`badge ${
          connectionStatus === "connected" ? "bg-success" :
          connectionStatus === "connecting" ? "bg-warning" :
          connectionStatus === "error" ? "bg-danger" :
          "bg-secondary"
        }`}>
          {connectionStatus.toUpperCase()}
        </small>
      </div>

      <div
        className={`mic-button ${isRecording ? "mic-recording" : ""}`}
        onClick={handleMicClick}
        role="button"
        aria-pressed={isRecording}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
        style={{ cursor: "pointer" }}
      >
        <img src={micImg} alt="microphone" className="mic-image" />
        {isRecording && (
          <div className="waveform">
            <span className="bar b1" />
            <span className="bar b2" />
            <span className="bar b3" />
            <span className="bar b4" />
            <span className="bar b5" />
          </div>
        )}
      </div>

      {isRecording && (
        <div className="mt-2 text-center">
          <div className="progress" style={{ width: "200px", height: "10px" }}>
            <div
              className={`progress-bar ${
                audioLevel > 20
                  ? "bg-success"
                  : audioLevel > 10
                  ? "bg-warning"
                  : "bg-danger"
              }`}
              role="progressbar"
              style={{ width: `${audioLevel}%` }}
            ></div>
          </div>
          <small className="text-muted">Audio Level: {audioLevel}</small>
        </div>
      )}

      {/* <div
        ref={chatBoxRef}
        className="chat-box mt-4 w-75 p-3 border rounded"
        style={{
          height: "300px",
          overflowY: "auto",
          backgroundColor: "var(--bs-dark)",
          borderColor: "var(--bs-gray-700) !important",
          color: "var(--bs-light)"
        }}
      >
        {conversation.map((msg, i) => (
          <div
            key={i}
            className={`chat-message ${
              msg.from === "user" ? "text-end" : "text-start"
            } mb-2`}
          >
            <span
              className={`px-3 py-2 rounded-2 d-inline-block ${
                msg.from === "user"
                  ? "bg-primary text-white"
                  : "bg-secondary text-light"
              }`}
              style={{
                maxWidth: "80%",
                wordBreak: "break-word"
              }}
            >
              {msg.text}
            </span>
          </div>
        ))}

        {conversation.length === 0 && (
          <div className="text-muted text-center" style={{ color: "var(--bs-gray-500) !important" }}>
            Start speaking to begin...
          </div>
        )}
      </div> */}
    </div>
  );
}
