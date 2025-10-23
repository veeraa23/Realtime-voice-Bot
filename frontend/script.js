// Voice Bot - Production Architecture (Browser → Backend → Azure)
// Secure: API keys stay on server, authentication supported

const micBtn = document.getElementById('micBtn');
const closeBtn = document.getElementById('closeBtn');
const mainOrb = document.querySelector('.main-orb');
const glowRings = document.querySelectorAll('.glow-ring');
const statusText = document.querySelector('.status-text');
const settingsIcon = document.querySelector('.settings-icon');

let isListening = false;
let isConnected = false;
let ws = null;
let audioContext = null;
let mediaStream = null;
let audioWorkletNode = null;

// Audio playback
let audioChunks = [];
let isProcessingAudio = false;
let nextPlayTime = 0;
let currentAudioSource = null;
let scheduledSources = [];

// Response tracking
let activeResponseId = null;
let completedResponses = new Set();
let responseTranscripts = new Map();
let cancelledResponses = new Set();
let isCancelling = false;
let lastBargeInTime = 0;
let bargeInCooldownMs = 1200;

console.log('🎤 Voice Bot Initialized (Production Mode)');
console.log('🔒 Secure: Connecting through backend server');
updateStatus('Click microphone to start');

// Connect to our backend server (which proxies to Azure)
async function connectToAzure() {
    try {
        updateStatus('Connecting...');
        console.log('🔗 Connecting to backend server...');
        
        let wsUrl = SERVER_CONFIG.websocketUrl;
        
        // Add authentication token as query parameter if available
        // In production, get this token from your login system
        if (SERVER_CONFIG.authToken) {
            wsUrl += `?token=${encodeURIComponent(SERVER_CONFIG.authToken)}`;
            console.log('🔐 Using authentication token');
        }
        
        console.log('WebSocket URL:', wsUrl);
        
        // Connect to our backend (not Azure directly)
        // Backend will:
        // 1. Authenticate the connection
        // 2. Check rate limits
        // 3. Create session
        // 4. Proxy to Azure with server-side API key
        // 5. Forward all messages bidirectionally
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('✅ Connected!');
            isConnected = true;
            updateStatus('Connected - Ready');
            sendSessionUpdate();
        };
        
        ws.onmessage = (event) => handleAzureMessage(event.data);
        
        ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            updateStatus('Connection error');
        };
        
        ws.onclose = (event) => {
            console.log('🔌 Disconnected', event.code, event.reason);
            isConnected = false;
            updateStatus('Disconnected');
            if (isListening) stopListening();
        };
    } catch (error) {
        console.error(' Failed:', error);
        updateStatus('Failed: ' + error.message);
    }
}

// Send session config
function sendSessionUpdate() {
    ws.send(JSON.stringify({
        type: 'session.update',
        session: {
            instructions: 'You are a helpful voice assistant. Respond naturally and concisely.',
            modalities: ['audio', 'text'],
            turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500
            },
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            voice: 'alloy'
        }
    }));
}

// Handle Azure messages
function handleAzureMessage(data) {
    try {
        const event = JSON.parse(data);
        
        switch (event.type) {
            case 'session.created':
                console.log('✅ Session created');
                break;
                
            case 'input_audio_buffer.speech_started':
                const nowTs = Date.now();
                // Debounce multiple rapid speech_started events
                if (nowTs - lastBargeInTime < bargeInCooldownMs) {
                    console.log('🛑 Ignoring speech_started (within cooldown)');
                    break;
                }
                // Only treat as interruption if AI audio is currently playing or active response present
                const aiSpeaking = scheduledSources.length > 0 || currentAudioSource;
                if (aiSpeaking || (activeResponseId && !isCancelling)) {
                    console.log('⚡ INTERRUPTION DETECTED - Cancelling AI response');
                    interruptForUserSpeech();
                    lastBargeInTime = nowTs;
                } else {
                    console.log('🎤 Speech detected');
                }
                break;
                
            case 'input_audio_buffer.speech_stopped':
                console.log('⏸️ Speech ended');
                break;
                
            case 'conversation.item.input_audio_transcription.completed':
                if (event.transcript) console.log('👤 You:', event.transcript);
                break;
                
            case 'response.created':
                updateStatus('AI thinking...');
                console.log('🤖 AI response started');
                // Allow currently scheduled audio to finish; only reset chunk accumulator
                audioChunks = [];
                // Maintain nextPlayTime so new audio appends seamlessly
                isCancelling = false;
                activeResponseId = event.response?.id || event.response_id;
                // Clear any leftover cancelled response audio
                stopAllScheduledAudio();
                break;
                
            case 'response.audio_transcript.delta':
                if (event.delta) console.log('💬', event.delta);
                break;
                
            case 'response.audio.delta':
                const audioData = event.delta;
                if (audioData) {
                    // Ignore audio if we're cancelling
                    if (isCancelling) {
                        console.log('⚠️ Ignoring audio delta during cancellation');
                        break;
                    }
                    audioChunks.push(audioData);
                    processAudioBuffer();
                }
                break;
            case 'response.audio.done':
                console.log('🏁 Audio complete');
                processAudioBuffer(true);
                break;
                
            case 'response.done':
                const doneResponseId = event.response?.id || event.response_id;
                if (doneResponseId) {
                    completedResponses.add(doneResponseId);
                    if (activeResponseId === doneResponseId) {
                        activeResponseId = null;
                    }
                }
                console.log('✅ Response complete');
                updateStatus(isListening ? 'Listening...' : 'Ready');
                processAudioBuffer(true);
                break;
                
            case 'error':
                console.error('❌ Error:', event.error);
                break;
        }
    } catch (error) {
        console.error('❌ Parse error:', error);
    }
}

// Microphone button
micBtn.addEventListener('click', async () => {
    if (!isConnected) {
        await connectToAzure();
        return;
    }
    
    isListening = !isListening;
    if (isListening) await startListening();
    else stopListening();
});

// Close button
closeBtn.addEventListener('click', () => {
    console.log('🔴 Stop button pressed - Ending session');
    
    // Stop listening
    if (isListening) {
        stopListening();
    }
    
    // Stop all audio immediately
    stopAllScheduledAudio();
    
    // Clear all audio buffers
    audioChunks = [];
    isProcessingAudio = false;
    nextPlayTime = 0;
    
    // Cancel active response if any
    if (ws && ws.readyState === WebSocket.OPEN && activeResponseId) {
        console.log('⛔ Cancelling active response before closing');
        const cancelMsg = {
            type: 'response.cancel',
            response_id: activeResponseId,
            event_id: ''
        };
        ws.send(JSON.stringify(cancelMsg));
    }
    
    // Close WebSocket connection
    if (ws) {
        ws.close();
        ws = null;
    }
    
    // Reset state
    isConnected = false;
    activeResponseId = null;
    completedResponses.clear();
    responseTranscripts.clear();
    cancelledResponses.clear();
    isCancelling = false;
    
    // Stop microphone
    if (audioWorkletNode) {
        audioWorkletNode.disconnect();
        audioWorkletNode = null;
    }
    
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }
    
    // Close audio context
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    updateStatus('Session ended');
    console.log('✅ Session completely stopped');
});

// Settings
settingsIcon.addEventListener('click', () => {
    alert(`Endpoint: ${AZURE_CONFIG.endpoint}\nConnected: ${isConnected}\nListening: ${isListening}`);
});

// Start listening
async function startListening() {
    micBtn.classList.add('active');
    mainOrb.classList.add('active');
    glowRings.forEach(r => r.classList.add('active'));
    statusText.classList.add('active');
    updateStatus('Listening...');
    
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        }
        if (audioContext.state === 'suspended') await audioContext.resume();
        
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true }
        });
        
        await audioContext.audioWorklet.addModule('audio-processor.js');
        const source = audioContext.createMediaStreamSource(mediaStream);
        audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');
        
        audioWorkletNode.port.onmessage = (event) => {
            if (isListening && ws && ws.readyState === WebSocket.OPEN) {
                const base64 = arrayBufferToBase64(event.data);
                ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
            }
        };
        
        source.connect(audioWorkletNode);
        console.log(' Recording');
    } catch (error) {
        console.error(' Mic error:', error);
        updateStatus('Microphone denied');
        stopListening();
    }
}

// Stop listening
function stopListening() {
    micBtn.classList.remove('active');
    mainOrb.classList.remove('active');
    glowRings.forEach(r => r.classList.remove('active'));
    statusText.classList.remove('active');
    updateStatus('Processing...');
    
    if (audioWorkletNode) audioWorkletNode.disconnect();
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    audioWorkletNode = null;
    mediaStream = null;
}

// Process audio buffer
function processAudioBuffer(isComplete = false) {
    // Don't process if already processing
    if (isProcessingAudio) return;
    
    // If we are cancelling, ignore any buffered audio until new response
    if (isCancelling) {
        console.log('⚠️ Cancellation in progress - skipping buffer processing');
        return;
    }
    
    const minChunks = isComplete ? 1 : 3;
    if (audioChunks.length < minChunks) return;
    
    const chunksToProcess = audioChunks.splice(0, audioChunks.length);
    if (chunksToProcess.length > 0) {
        isProcessingAudio = true;
        playAudioChunks(chunksToProcess).then(() => {
            isProcessingAudio = false;
            if (audioChunks.length > 0) setTimeout(() => processAudioBuffer(false), 10);
        }).catch(err => {
            console.error('❌ Audio error:', err);
            isProcessingAudio = false;
        });
    }
}

// Play audio chunks
async function playAudioChunks(chunks) {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        }
        if (audioContext.state === 'suspended') await audioContext.resume();
        
        let totalLength = 0;
        const pcmArrays = [];
        
        for (const base64 of chunks) {
            try {
                const audioData = base64ToArrayBuffer(base64);
                const pcm = new Int16Array(audioData);
                pcmArrays.push(pcm);
                totalLength += pcm.length;
            } catch (err) {
                console.error('Decode error:', err);
            }
        }
        
        if (totalLength === 0) return;
        
        const combined = new Int16Array(totalLength);
        let offset = 0;
        for (const pcm of pcmArrays) {
            combined.set(pcm, offset);
            offset += pcm.length;
        }
        
        const buffer = audioContext.createBuffer(1, combined.length, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < combined.length; i++) {
            channelData[i] = combined[i] / 32768.0;
        }
        
        await schedulePlayback(buffer);
    } catch (error) {
        console.error(' Play error:', error);
    }
}

// Schedule playback
async function schedulePlayback(buffer) {
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (buffer.duration < 0.01) return;
    
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    gain.gain.value = 1.2;
    source.connect(gain);
    gain.connect(audioContext.destination);
    
    const currentTime = audioContext.currentTime;
    const startTime = Math.max(currentTime, nextPlayTime);
    
    console.log('▶️ Playing', buffer.duration.toFixed(2), 's at', startTime.toFixed(2));
    
    source.start(startTime);
    currentAudioSource = source;
    
    // Track scheduled source for potential interruption
    scheduledSources.push({ source, startTime, duration: buffer.duration });
    
    // Update next play time for seamless playback
    nextPlayTime = startTime + buffer.duration;
    
    // Auto-cleanup when finished
    source.onended = () => {
        console.log('✅ Audio chunk ended');
        if (currentAudioSource === source) {
            currentAudioSource = null;
        }
        // Remove from scheduled list
        scheduledSources = scheduledSources.filter(s => s.source !== source);
    };
    
    // Add error handling
    source.onerror = (error) => {
        console.error('❌ Audio playback error:', error);
    };
}

// Interrupt current AI response for user speech
function interruptForUserSpeech() {
    try {
        console.log('🛑 STOPPING ALL AUDIO FOR INTERRUPTION');
        
        // Stop current playback immediately
        stopAllScheduledAudio();
        
        // Clear queued / in-flight audio
        audioChunks = [];
        isProcessingAudio = false;
        nextPlayTime = audioContext ? audioContext.currentTime : 0;
        
        // Cancel active response server-side
        if (ws && ws.readyState === WebSocket.OPEN && activeResponseId && !completedResponses.has(activeResponseId)) {
            console.log('⛔ Sending response.cancel for response', activeResponseId);
            const cancelMsg = {
                type: 'response.cancel',
                response_id: activeResponseId,
                event_id: ''
            };
            ws.send(JSON.stringify(cancelMsg));
            cancelledResponses.add(activeResponseId);
            isCancelling = true;
        }
        
        updateStatus('Listening...');
    } catch (e) {
        console.error('❌ Error during interruption:', e);
    }
}

// Stop all scheduled audio sources
function stopAllScheduledAudio() {
    const now = audioContext ? audioContext.currentTime : 0;
    console.log('🛑 Stopping all scheduled audio sources. Count:', scheduledSources.length, 'currentTime:', now);
    
    for (const entry of scheduledSources) {
        try {
            entry.source.stop();
        } catch (e) {
            // Already stopped
        }
    }
    
    scheduledSources = [];
    currentAudioSource = null;
}

// Update status
function updateStatus(msg) {
    statusText.textContent = msg;
}

// Utils
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        micBtn.click();
    }
    if (e.code === 'Escape') closeBtn.click();
});

console.log(' Ready - Click microphone!');
