/** Audio frequency measured in Hertz (Hz). */
export type Frequency = number;
/** Time duration or timestamp measured in seconds. */
export type TimeSec = number;
/** Symbol rate measured in symbols per second (Baud). */
export type BaudRate = number;
/** All the numbers in the universe. */
export type Bit = 0 | 1;

const enum WaveType {
  SINE = 0,
  COSINE = 1,
}

/** Prepares the bitstream for a modulation method
 *
 * @param dataBits - The raw data bits to be transmitted (LSB first)
 * @param repeats - Number of times to repeat the data sequence for redundancy
 * @param preamble - Length of time in seconds to play the mark tone before message
 * @param preFlags - Number of flag octets to prepend before the data bits
 * @param postFlags - Number of flag octets to append after the data bits
 * @param flagOctet - The bit pattern to use for flag octets
 * @param baudRate - The symbol rate
 */
function prepareBitStream(
  dataBits: Bit[],
  repeats: number,
  preamble: TimeSec,
  preFlags: number,
  postFlags: number,
  flagOctet: Bit[],
  baudRate: BaudRate,
): Bit[] {
  const preambleMarkLength = Math.ceil(preamble * baudRate);
  const preambleFlagsLength = preFlags * flagOctet.length;
  const preambleLength = preambleMarkLength + preambleFlagsLength;
  const postambleLength = postFlags * flagOctet.length;
  const dataLength = dataBits.length * repeats;
  const totalFrameLength = preambleLength + dataLength + postambleLength;
  if (totalFrameLength === 0) {
    return [];
  }

  const bitStream: Bit[] = [];
  for (let r = 0; r < repeats; r++) {
    bitStream.push(...new Array(preambleMarkLength).fill(1));
    for (let i = 0; i < preFlags; i++) {
      bitStream.push(...flagOctet);
    }
    bitStream.push(...dataBits);
    for (let i = 0; i < postFlags; i++) {
      bitStream.push(...flagOctet);
    }
  }

  return bitStream;
}

/**
 * Encodes data bits as FSK modulation.
 *
 * @param ctx - The AudioContext to use for oscillator creation
 * @param outputNode - The audio node to connect the oscillator to
 * @param dataBits - Array of bits to encode (LSB first)
 * @param spaceFreq - Frequency (Hz) to use for bit value 0
 * @param markFreq - Frequency (Hz) to use for bit value 1
 * @param startTime - Start time in seconds
 * @param repeats - Number of times to repeat the data sequence
 * @param preamble - Length of time in seconds to play the mark tone before message
 * @param preFlags - Number of flag octets to prepend
 * @param postFlags - Number of flag octets to append
 * @param flagOctet - Bit pattern to use for flag octets
 * @param baudRate - Symbol rate in Baud (bits per second)
 * @returns The stop time of the oscillator
 */
export function encodeFSK(
  ctx: BaseAudioContext,
  outputNode: AudioNode,
  dataBits: Bit[],
  spaceFreq: Frequency,
  markFreq: Frequency,
  startTime: TimeSec,
  repeats: number = 1,
  preamble: TimeSec = 0.1,
  preFlags: number = 3,
  postFlags: number = 2,
  baudRate: BaudRate = 300,
  flagOctet: Bit[] = [0, 1, 1, 1, 1, 1, 1, 0],
): TimeSec {
  const bitStream = prepareBitStream(
    dataBits,
    repeats,
    preamble,
    preFlags,
    postFlags,
    flagOctet,
    baudRate,
  );

  const osc = ctx.createOscillator();
  osc.type = "sine";
  // Set default frequency to the first bit's frequency to avoid initial clicks
  osc.frequency.value = bitStream[0] === 1 ? markFreq : spaceFreq;
  const bitDuration = 1 / baudRate;
  let currentTime = startTime;

  for (const bit of bitStream) {
    const freq = bit === 1 ? markFreq : spaceFreq;
    osc.frequency.setValueAtTime(freq, currentTime);
    currentTime += bitDuration;
  }

  osc.connect(outputNode);
  osc.start(startTime);
  osc.stop(currentTime);

  return currentTime;
}

/**
 * Encodes data bits as DPSK modulation.
 * * In binary DPSK:
 * - A bit '0' means no change in phase (multiply current phase state by 1)
 * - A bit '1' means a 180-degree change in phase (multiply current phase state by -1)
 *
 * @param ctx - The AudioContext to use for oscillator creation
 * @param outputNode - The audio node to connect the modulated signal to
 * @param dataBits - Array of bits to encode (LSB first)
 * @param carrierFreq - The single carrier frequency (Hz) used for the modulation
 * @param startTime - Start time in seconds
 * @param repeats - Number of times to repeat the data sequence
 * @param preamble - Length of time in seconds to play the unmodulated carrier before message
 * @param preFlags - Number of flag octets to prepend
 * @param postFlags - Number of flag octets to append
 * @param baudRate - Symbol rate in Baud (bits per second)
 * @param flagOctet - Bit pattern to use for flag octets
 * @returns The stop time of the transmission
 */
export function encodeDPSK(
  ctx: BaseAudioContext,
  outputNode: AudioNode,
  dataBits: Bit[],
  carrierFreq: Frequency,
  startTime: TimeSec,
  repeats: number = 1,
  preamble: TimeSec = 0.1,
  preFlags: number = 3,
  postFlags: number = 2,
  baudRate: BaudRate = 600,
  flagOctet: Bit[] = [0, 1, 1, 1, 1, 1, 1, 0],
): TimeSec {
  const bitStream = prepareBitStream(
    dataBits,
    repeats,
    preamble,
    preFlags,
    postFlags,
    flagOctet,
    baudRate,
  );

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = carrierFreq;
  const bitDuration = 1 / baudRate;
  let currentTime = startTime;

  const phaseModulator = ctx.createGain();
  let currentPhaseState = 1;
  phaseModulator.gain.setValueAtTime(currentPhaseState, currentTime);

  for (const bit of bitStream) {
    if (bit === 1) {
      currentPhaseState = -currentPhaseState;
      phaseModulator.gain.setValueAtTime(currentPhaseState, currentTime);
    }
    currentTime += bitDuration;
  }

  osc.connect(phaseModulator);
  phaseModulator.connect(outputNode);
  osc.start(startTime);
  osc.stop(currentTime);

  return currentTime;
}

/**
 * Maps a 4-bit block to V.34 TRN Cartesian coordinates (I, Q).
 * Grouping is processed as b1 b2 b3 b4.
 */
function mapBitsToIQ(
  b1: Bit,
  b2: Bit,
  b3: Bit,
  b4: Bit,
): { I: number; Q: number } {
  // Bitwise index calculation
  const index = (b1 << 3) | (b2 << 2) | (b3 << 1) | b4;

  // Derived from the ITU-T V.34 TRN mapping spec
  const lookupTable: { I: number; Q: number }[] = [
    { I: 1, Q: 1 }, // 0000
    { I: 3, Q: 1 }, // 0001
    { I: 1, Q: 3 }, // 0010
    { I: 3, Q: 3 }, // 0011
    { I: 5, Q: 1 }, // 0100
    { I: 5, Q: 3 }, // 0101
    { I: 1, Q: 5 }, // 0110
    { I: 3, Q: 5 }, // 0111
    { I: -1, Q: -1 }, // 1000
    { I: -3, Q: -1 }, // 1001
    { I: -1, Q: -3 }, // 1010
    { I: -3, Q: -3 }, // 1011
    { I: -5, Q: -1 }, // 1100
    { I: -5, Q: -3 }, // 1101
    { I: -1, Q: -5 }, // 1110
    { I: -5, Q: -5 }, // 1111
  ];

  return lookupTable[index]!;
}

/**
 * Creates a carrier branch with the specified amplitudes and wave type.
 * This function abstracts the common logic for both the In-Phase (I) and Quadrature (Q) paths in QAM modulation.
 *
 * @param ctx - The AudioContext to use for oscillator and gain node creation
 * @param outputNode - The audio node to connect the carrier branch to
 * @param amplitudes - An array of amplitude values corresponding to each symbol period
 * @param waveType - The type of waveform to generate ("sine" for Q path, "cosine" for I path)
 * @param carrierFreq - The carrier frequency in Hz
 * @param startTime - The start time in seconds for the carrier generation
 * @param symbolDuration - The duration of each symbol in seconds (inverse of baud rate)
 * @param stopTime - The time in seconds to stop the carrier generation
 * @returns void
 */
const createCarrierBranch = (
  ctx: BaseAudioContext,
  outputNode: AudioNode,
  amplitudes: number[],
  waveType: WaveType,
  carrierFreq: Frequency,
  startTime: TimeSec,
  symbolDuration: TimeSec,
  stopTime: TimeSec,
) => {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  if (waveType === WaveType.COSINE) {
    // Create a true phase-shifted cosine profile using PeriodicWave
    const cosReal = new Float32Array([0, 1]);
    const cosImag = new Float32Array([0, 0]);
    osc.setPeriodicWave(ctx.createPeriodicWave(cosReal, cosImag));
  } else {
    osc.type = "sine";
  }

  osc.frequency.value = carrierFreq;
  gainNode.gain.setValueAtTime(0, startTime);

  // Iteratively schedule amplitude thresholds across the timeline
  let symbolTime = startTime;
  for (const amp of amplitudes) {
    gainNode.gain.setValueAtTime(amp, symbolTime);
    symbolTime += symbolDuration;
  }

  // Connect local topology to unified mixer
  osc.connect(gainNode);
  gainNode.connect(outputNode);

  // Lifecycle triggers
  osc.start(startTime);
  osc.stop(stopTime);
};

/**
 * Encodes data bits using 16-point QAM modulation based on V.34 TRN mapping.
 *
 * @param ctx - The AudioContext to use for oscillator and gain node creation
 * @param outputNode - The destination audio node to connect the combined signal to
 * @param dataBits - Array of raw bits to encode. Length must be a multiple of 4.
 * @param carrierFreq - Carrier frequency in Hz (e.g., 1600 or 1800 Hz for 2400 Baud)
 * @param startTime - Start time in seconds
 * @param repeats - Number of times to repeat the entire structured frame
 * @param preFlags - Number of flag octets to prepend to data
 * @param postFlags - Number of flag octets to append to data
 * @param baudRate - Symbol rate in Baud (defaults to 2400 for V.34 TRN)
 * @param alpha - Normalization scale factor to protect telephone line line cards
 * @param flagOctet - Bit pattern to use for flag octets (8 bits)
 * @returns The stop time of the transmission
 */
export function encodeQAM16(
  ctx: BaseAudioContext,
  outputNode: AudioNode,
  dataBits: Bit[],
  carrierFreq: Frequency,
  startTime: TimeSec,
  repeats: number = 1,
  preFlags: number = 3,
  postFlags: number = 2,
  baudRate: BaudRate = 2400,
  alpha: number = 0.1,
  flagOctet: Bit[] = [0, 1, 1, 1, 1, 1, 1, 0],
): TimeSec {
  // 1. Validation Checks
  if (dataBits.length % 4 !== 0) {
    throw new Error("Data bits lengths must be a multiple of 4 for QAM-16.");
  }

  // 2. Frame Assembly
  const bitStream: Bit[] = [];
  for (let r = 0; r < repeats; r++) {
    for (let i = 0; i < preFlags; i++) bitStream.push(...flagOctet);
    bitStream.push(...dataBits);
    for (let i = 0; i < postFlags; i++) bitStream.push(...flagOctet);
  }

  if (bitStream.length === 0) {
    return startTime;
  }

  // 3. Vector Mapping (Translate 4-bit blocks into separate I and Q coordinate arrays)
  const iAmplitudes: number[] = [];
  const qAmplitudes: number[] = [];
  for (let s = 0; s < bitStream.length; s += 4) {
    // s is guaranteed to be divisible by 4, so we can use the non-null assertion op here
    const coords = mapBitsToIQ(
      bitStream[s]!,
      bitStream[s + 1]!,
      bitStream[s + 2]!,
      bitStream[s + 3]!,
    );
    iAmplitudes.push(coords.I * alpha);
    qAmplitudes.push(coords.Q * alpha);
  }
  // Calculate symbol timeline properties
  const symbolDuration = 1 / baudRate;
  const totalDuration = iAmplitudes.length * symbolDuration;
  const stopTime = startTime + totalDuration;

  // 4. Unified Mixer Node
  const IQMixer = ctx.createGain();
  IQMixer.gain.value = 1.0;
  IQMixer.connect(outputNode);

  // Instantiates the In-Phase path
  createCarrierBranch(
    ctx,
    IQMixer,
    iAmplitudes,
    WaveType.COSINE,
    carrierFreq,
    startTime,
    symbolDuration,
    stopTime,
  );
  // Instantiates the Quadrature path
  createCarrierBranch(
    ctx,
    IQMixer,
    qAmplitudes,
    WaveType.SINE,
    carrierFreq,
    startTime,
    symbolDuration,
    stopTime,
  );

  return stopTime;
}
