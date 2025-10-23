// Audio Processor Worklet for capturing microphone audio
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2400; // 100ms at 24kHz
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (input && input.length > 0) {
            const inputChannel = input[0];
            
            for (let i = 0; i < inputChannel.length; i++) {
                this.buffer[this.bufferIndex++] = inputChannel[i];
                
                // When buffer is full, send it
                if (this.bufferIndex >= this.bufferSize) {
                    // Convert Float32 to PCM16
                    const pcm16 = new Int16Array(this.bufferSize);
                    for (let j = 0; j < this.bufferSize; j++) {
                        const s = Math.max(-1, Math.min(1, this.buffer[j]));
                        pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }
                    
                    // Send PCM16 data to main thread
                    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
                    
                    // Reset buffer
                    this.buffer = new Float32Array(this.bufferSize);
                    this.bufferIndex = 0;
                }
            }
        }
        
        return true; // Keep processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
