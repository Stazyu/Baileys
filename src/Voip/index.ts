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
	authDir?: string
	/** Optional maximum simultaneous outgoing calls limit. */
	maxConcurrentCalls?: number
}

export type VoipConfigOptions = {
	maxConcurrentCalls?: number
	onLimit?: 'reject' | 'queue'
}

export type CallOptions = {
	to?: string
	audioSource?: string
	/** Video source: file path to MP4/MKV/MOV/AVI video file. */
	videoSource?: string
	/** Whether this is a video call (default false). */
	isVideo?: boolean
	videoLoop?: boolean
	repeatVideo?: boolean
	loop?: boolean
	videoWidth?: number
	width?: number
	videoHeight?: number
	height?: number
	videoFps?: number
	fps?: number
	isHorizontal?: boolean
	horizontal?: boolean
	orientation?: number
	videoOrientation?: number
	durationMs?: number
	durationMS?: number
	/** Repeat/loop the audio source continuously (default false). */
	repeatAudio?: boolean
	repeat?: boolean
	/** Timeout waiting for remote device to confirm ringing in ms (default 20000). */
	preRingingTimeoutMs?: number
}

export type CallStatus =
	| 'idle'
	| 'initiating'
	| 'signaling'
	| 'ringing'
	| 'accepted'
	| 'media_connecting'
	| 'connected'
	| 'audio_ready'
	| 'streaming'
	| 'ending'
	| 'ended'
	| 'failed'
	| 'unreachable'
	| 'rejected'
	| 'timeout'

export type CallSummary = {
	id: string
	jid: string
	status: CallStatus
	state: CallState
	startedAt: number
	connectedAt?: number
	endedAt?: number
	durationMs: number
	audioSource: string
	repeatAudio: boolean
	isVideo?: boolean
	isHorizontal?: boolean
	videoOrientation?: number
	videoSource?: string | null
}

export type CallRequest = {
	jid: string
	options?: CallOptions
}

export type CallEvents = {
	ringing: () => void
	accepted: () => void
	connected: () => void
	audioReady: () => void
	streaming: () => void
	videoStarted: () => void
	videoEnded: () => void
	videoError: (err: Error) => void
	stateChange: (status: CallStatus) => void
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

export type RelayListUpdate = {
	relay_key: string
	relay_tokens: string[]
	auth_tokens?: string[]
	enable_edgeray_dtls_active_mode?: boolean
	relays: ReadonlyArray<{
		relay_id: number
		relay_name: string
		token_id: number
		auth_token_id?: number
		addresses: ReadonlyArray<{
			protocol: number
			ipv4?: string
			ipv6?: string
			port?: number
			port_v6?: number
		}>
	}>
}

type WasmEngine = unknown

/** A live or recently-ended call. */
export class ActiveCall extends EventEmitter {
	readonly callId!: string
	readonly peerJid!: string
	readonly phoneNumber!: string
	readonly startedAt!: number
	readonly connectedAt!: number | null
	readonly endedAt!: number | null

	constructor(_callId: string, _peerJid: string, _engine: WasmEngine, _options: CallOptions = {}, _phoneNumber = '') {
		super()
		throw new Error('ActiveCall must be constructed by VoipClient')
	}
	get state(): CallState {
		throw new Error('unreachable')
	}
	get status(): CallStatus {
		throw new Error('unreachable')
	}
	get ended(): boolean {
		throw new Error('unreachable')
	}
	getSummary: () => CallSummary = () => {
		throw new Error('unreachable')
	}
	end: (reason?: string) => void = () => {}
	mute: (_muted: boolean) => void = () => {}
	waitForEnd: () => Promise<string> = async () => ''
	/** @internal */
	_updateState: (_state: number) => void = () => {}
	/** @internal */
	_handleSignalingEvent: (_tag: string, _reason: string) => void = () => {}
	/** @internal */
	_handleSignalingError: (_tag: string, _errorType: string) => void = () => {}
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
	call: (phoneNumber: string, opts?: CallOptions) => Promise<ActiveCall>
	callMany: (requests: CallRequest[]) => Promise<ActiveCall[]>
	getActiveCalls: () => CallSummary[]
	getCall: (callId: string) => ActiveCall | undefined
	getActiveCallCount: () => number
	setOptions: (options: VoipConfigOptions) => void
	endCall: (callId: string) => void
	endAllCalls: () => void
	disconnect: () => void
}

/** Top-level client. Connects to WhatsApp and lets you place calls. */
export class VoipClient {
	#config: VoipSdkConfig
	#impl: VoipClientImpl | null = null

	constructor(config: VoipSdkConfig = {}) {
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

	/** Place an outbound voice or video call. */
	async call(phoneNumber: string, opts?: CallOptions): Promise<ActiveCall> {
		const client = await this.#getImpl()
		return client.call(phoneNumber, opts)
	}

	/** Place several calls concurrently. */
	async callMany(requests: CallRequest[]): Promise<ActiveCall[]> {
		const client = await this.#getImpl()
		return client.callMany(requests)
	}

	/** Snapshot of all active calls. */
	getActiveCalls(): CallSummary[] {
		return this.#impl?.getActiveCalls() ?? []
	}

	/** Look up a single active call by id. */
	getCall(callId: string): ActiveCall | undefined {
		return this.#impl?.getCall(callId)
	}

	/** Number of currently active calls. */
	getActiveCallCount(): number {
		return this.#impl?.getActiveCallCount() ?? 0
	}

	/** Adjust manager options at runtime. */
	setOptions(options: VoipConfigOptions): void {
		this.#impl?.setOptions(options)
	}

	/** End a single active call. */
	endCall(callId: string): void {
		this.#impl?.endCall(callId)
	}

	/** End every active call. */
	endAllCalls(): void {
		this.#impl?.endAllCalls()
	}

	/** Tear down the WhatsApp socket and release resources. */
	disconnect(): void {
		this.#impl?.disconnect()
		this.#impl = null
	}
}
