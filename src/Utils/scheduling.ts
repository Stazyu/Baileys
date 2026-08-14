import type { AnyMessageContent, WAMessage } from '../Types'

/** A single scheduled message entry */
export interface ScheduledMessage {
	/** Unique ID */
	id: string
	/** Recipient JID */
	jid: string
	/** Message content */
	content: AnyMessageContent
	/** When the message will be sent */
	scheduledTime: Date
	/** When the entry was created */
	createdAt: Date
	/** Current status */
	status: 'pending' | 'sent' | 'failed' | 'cancelled'
	/** Error message if status is 'failed' */
	error?: string
	/** WhatsApp message ID after successful send */
	messageId?: string
}

/** Options for the scheduler */
export interface SchedulerOptions {
	/** Maximum number of pending messages allowed in the queue (default: 1000) */
	maxQueue?: number
	/** How often (ms) the queue is checked for due messages (default: 1000) */
	checkInterval?: number
	/** Called when a message is successfully sent */
	onSent?: (scheduled: ScheduledMessage, message: WAMessage | undefined) => void
	/** Called when a message fails to send */
	onFailed?: (scheduled: ScheduledMessage, error: Error) => void
}

/** The function signature expected by the scheduler to send messages */
export type SendMessageFunction = (jid: string, content: AnyMessageContent) => Promise<WAMessage | undefined>

/** In-memory message scheduler. */
export class MessageScheduler {
	private queue = new Map<string, ScheduledMessage>()
	private timer: ReturnType<typeof setInterval> | null = null

	private sendMessage: SendMessageFunction
	private options: Required<SchedulerOptions>

	constructor(sendMessage: SendMessageFunction, options: SchedulerOptions = {}) {
		this.sendMessage = sendMessage
		this.options = {
			maxQueue: options.maxQueue ?? 1000,
			checkInterval: options.checkInterval ?? 1000,
			onSent: options.onSent ?? (() => {}),
			onFailed: options.onFailed ?? (() => {})
		}
	}

	private generateId() {
		return `sched_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
	}

	/** Schedule a message to be sent at a specific Date. */
	schedule(jid: string, content: AnyMessageContent, scheduledTime: Date): ScheduledMessage {
		if (this.queue.size >= this.options.maxQueue) {
			throw new Error(`Maximum queue size (${this.options.maxQueue}) reached`)
		}

		if (scheduledTime.getTime() <= Date.now()) {
			throw new Error('Scheduled time must be in the future')
		}

		const scheduled: ScheduledMessage = {
			id: this.generateId(),
			jid,
			content,
			scheduledTime,
			createdAt: new Date(),
			status: 'pending'
		}

		this.queue.set(scheduled.id, scheduled)
		this.ensureTimerRunning()

		return scheduled
	}

	/** Schedule a message with a delay from now. */
	scheduleDelay(jid: string, content: AnyMessageContent, delayMs: number): ScheduledMessage {
		return this.schedule(jid, content, new Date(Date.now() + delayMs))
	}

	/** Cancel a pending message by ID. */
	cancel(id: string): boolean {
		const scheduled = this.queue.get(id)
		if (scheduled && scheduled.status === 'pending') {
			scheduled.status = 'cancelled'
			this.queue.delete(id)
			return true
		}
		return false
	}

	/** Cancel all pending messages for a specific JID. */
	cancelForJid(jid: string): number {
		let cancelled = 0
		for (const [id, scheduled] of this.queue) {
			if (scheduled.jid === jid && scheduled.status === 'pending') {
				scheduled.status = 'cancelled'
				this.queue.delete(id)
				cancelled++
			}
		}
		return cancelled
	}

	/** Get all currently pending scheduled messages */
	getPending(): ScheduledMessage[] {
		return Array.from(this.queue.values()).filter(s => s.status === 'pending')
	}

	/** Get a specific scheduled message by ID */
	get(id: string): ScheduledMessage | undefined {
		return this.queue.get(id)
	}

	/** Clear all pending messages and stop the timer. */
	clearAll(): number {
		const count = this.queue.size
		this.queue.clear()
		this.stopTimer()
		return count
	}

	/** Process the queue and send any due messages */
	private async processQueue() {
		const now = Date.now()

		for (const [id, scheduled] of this.queue) {
			if (scheduled.status !== 'pending') continue
			if (scheduled.scheduledTime.getTime() > now) continue

			try {
				const message = await this.sendMessage(scheduled.jid, scheduled.content)
				scheduled.status = 'sent'
				scheduled.messageId = message?.key?.id ?? undefined
				this.options.onSent(scheduled, message)
			} catch (error) {
				scheduled.status = 'failed'
				scheduled.error = (error as Error).message
				this.options.onFailed(scheduled, error as Error)
			}

			this.queue.delete(id)
		}

		if (this.queue.size === 0) {
			this.stopTimer()
		}
	}

	private ensureTimerRunning() {
		if (!this.timer) {
			this.timer = setInterval(() => this.processQueue(), this.options.checkInterval)
		}
	}

	private stopTimer() {
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}
	}

	/** Stop the internal check timer. Already-queued messages are preserved. */
	stop(): void {
		this.stopTimer()
	}

	/** (Re)start the timer. Only has effect if the queue is non-empty. */
	start(): void {
		if (this.queue.size > 0) {
			this.ensureTimerRunning()
		}
	}
}

/** Create a ready-to-use MessageScheduler. */
export const createMessageScheduler = (
	sendMessage: SendMessageFunction,
	options?: SchedulerOptions
): MessageScheduler => new MessageScheduler(sendMessage, options)
