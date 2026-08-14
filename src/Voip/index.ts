/**
 * Typed barrel for the vendored baileys-caller VoIP SDK.
 *
 * The implementation is the ESM module [`Voip/index.mjs`](../../Voip/index.mjs),
 * which wraps WhatsApp Web's official VoIP WASM stack and routes signaling
 * through a Baileys socket. The WASM binary, loader, and worker bundle are
 * vendored verbatim under [`Voip/Assets/Wasm/`](../../Voip/Assets/Wasm/).
 */

import { EventEmitter } from 'events'

export type VoipSdkConfig = {
	/** Path to a Baileys multi-file auth state directory. */
	authDir: string
}

export type CallOptions = {
	to: string
	audioSource?: string
	durationMs?: number
}

export type CallEvents = {
	ringing: () => void
	connected: () => void
	audio: (pcm: Float32Array) => void
	ended: (reason: string) => void
	error: (err: Error) => void
}

export type AudioConfig = {
	sampleRate: number
	channels: number
	bitsPerSample: number
	framesPerChunk: number
}

export const CallState = {
	Idle: 0,
	Calling: 1,
	PreacceptReceived: 2,
	ReceivedCall: 3,
	AcceptSent: 4,
	AcceptReceived: 5,
	Active: 6,
	ActiveElsewhere: 7,
	Ending: 13
} as const

export type CallState = (typeof CallState)[keyof typeof CallState]

type WasmEngine = unknown

/** A live or recently-ended call. */
export class ActiveCall extends EventEmitter {
	readonly callId!: string
	/** @internal mirrors the source path for the audio feeder */
	_audioSource!: string
	constructor(_callId: string, _engine: WasmEngine, _durationMs: number) {
		super()
		throw new Error('ActiveCall must be constructed by VoipClient')
	}
	get state(): CallState {
		throw new Error('unreachable')
	}
	end: () => void = () => {}
	mute: (_muted: boolean) => void = () => {}
	waitForEnd: () => Promise<string> = async () => ''
	/** @internal */
	_updateState: (_state: number) => void = () => {}
	/** @internal */
	_emitAudio: (_pcm: Float32Array) => void = () => {}
	/** @internal */
	_forceEnd: (_reason: string) => void = () => {}
}

/** Runtime import helper — avoids pulling the WASM stack at module load time. */
const loadClient = async () => {
	const mod = await import('../../Voip/index.mjs')
	return mod
}

type VoipClientImpl = {
	connect: () => Promise<void>
	initWithSocket: (sock: unknown) => Promise<void>
	call: (phoneNumber: string, opts?: { audioSource?: string; durationMs?: number }) => Promise<ActiveCall>
	disconnect: () => void
}

/** Top-level client. Connects to WhatsApp and lets you place calls. */
export class VoipClient {
	#config: VoipSdkConfig
	#impl: VoipClientImpl | null = null

	constructor(config: VoipSdkConfig) {
		this.#config = config
	}

	#getImpl = async (): Promise<VoipClientImpl> => {
		if (!this.#impl) {
			const { VoipClient: Impl } = await loadClient()
			this.#impl = new Impl(this.#config) as VoipClientImpl
		}
		return this.#impl
	}

	/** Connect to WhatsApp and bring up the WASM VoIP stack. */
	async connect(): Promise<void> {
		const client = await this.#getImpl()
		await client.connect()
	}

	/** Attach an already connected Baileys socket directly. */
	async initWithSocket(sock: unknown): Promise<void> {
		const client = await this.#getImpl()
		await client.initWithSocket(sock)
	}

	/** Place an outbound voice call. */
	async call(phoneNumber: string, opts?: { audioSource?: string; durationMs?: number }): Promise<ActiveCall> {
		const client = await this.#getImpl()
		return client.call(phoneNumber, opts)
	}

	/** Tear down the WhatsApp socket and release resources. */
	disconnect(): void {
		this.#impl?.disconnect()
		this.#impl = null
	}
}
