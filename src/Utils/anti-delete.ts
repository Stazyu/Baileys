import { proto } from '../../WAProto/index.js'
import type { WAMessage, WAMessageKey } from '../Types'

export interface StoredMessage {
	/** Original message */
	message: WAMessage
	/** Timestamp stored */
	storedAt: number
	/** Whether it has been deleted */
	isDeleted: boolean
	/** Timestamp deleted */
	deletedAt?: number
	/** Who deleted it */
	deletedBy?: string
}

export interface DeletedMessageInfo {
	/** Original message before deletion */
	originalMessage: WAMessage
	/** Key of the deleted message */
	key: WAMessageKey
	/** Timestamp deleted */
	deletedAt: number
	/** Who deleted it (participant for groups) */
	deletedBy?: string
	/** Whether it was revoked by the original sender */
	isRevokedBySender: boolean
}

export interface MessageStoreOptions {
	/** Max messages per chat */
	maxMessagesPerChat?: number
	/** TTL in ms (default 24 hours) */
	ttl?: number
	/** Auto cleanup interval in ms */
	cleanupInterval?: number
}

export class MessageStore {
	private store = new Map<string, Map<string, StoredMessage>>()
	private deletedMessages = new Map<string, DeletedMessageInfo>()
	private options: Required<MessageStoreOptions>
	private cleanupTimer?: ReturnType<typeof setInterval>

	constructor(options: MessageStoreOptions = {}) {
		this.options = {
			maxMessagesPerChat: options.maxMessagesPerChat ?? 1000,
			ttl: options.ttl ?? 24 * 60 * 60 * 1000,
			cleanupInterval: options.cleanupInterval ?? 60 * 60 * 1000
		}

		this.startCleanup()
	}

	private startCleanup() {
		this.cleanupTimer = setInterval(() => {
			this.cleanup()
		}, this.options.cleanupInterval)
	}

	/** Stop cleanup timer */
	stopCleanup() {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer)
		}
	}

	/** Cleanup old messages */
	cleanup() {
		const now = Date.now()
		const cutoff = now - this.options.ttl

		for (const [chatId, messages] of this.store) {
			for (const [msgId, stored] of messages) {
				if (stored.storedAt < cutoff) {
					messages.delete(msgId)
				}
			}

			if (messages.size === 0) {
				this.store.delete(chatId)
			}
		}

		for (const [key, info] of this.deletedMessages) {
			if (info.deletedAt < cutoff) {
				this.deletedMessages.delete(key)
			}
		}
	}

	private getKey(key: WAMessageKey): string {
		return `${key.remoteJid}:${key.id}`
	}

	/** Store message */
	storeMessage(message: WAMessage): void {
		const chatId = message.key.remoteJid
		if (!chatId || !message.key.id) return

		let chatMessages = this.store.get(chatId)
		if (!chatMessages) {
			chatMessages = new Map()
			this.store.set(chatId, chatMessages)
		}

		if (chatMessages.size >= this.options.maxMessagesPerChat) {
			const oldestKey = chatMessages.keys().next().value
			if (oldestKey) {
				chatMessages.delete(oldestKey)
			}
		}

		chatMessages.set(message.key.id, {
			message,
			storedAt: Date.now(),
			isDeleted: false
		})
	}

	/** Store multiple messages */
	storeMessages(messages: WAMessage[]): void {
		for (const msg of messages) {
			this.storeMessage(msg)
		}
	}

	/** Get stored message */
	getMessage(key: WAMessageKey): StoredMessage | undefined {
		const chatMessages = this.store.get(key.remoteJid!)
		if (!chatMessages) return undefined
		return chatMessages.get(key.id!)
	}

	/** Get original message (for anti-delete) */
	getOriginalMessage(key: WAMessageKey): WAMessage | undefined {
		return this.getMessage(key)?.message
	}

	/** Mark message as deleted and store info */
	markAsDeleted(key: WAMessageKey, deletedBy?: string): DeletedMessageInfo | null {
		const stored = this.getMessage(key)
		if (!stored) return null

		const now = Date.now()
		stored.isDeleted = true
		stored.deletedAt = now
		stored.deletedBy = deletedBy

		const info: DeletedMessageInfo = {
			originalMessage: stored.message,
			key,
			deletedAt: now,
			deletedBy,
			isRevokedBySender: !deletedBy || deletedBy === stored.message.key.participant
		}

		this.deletedMessages.set(this.getKey(key), info)
		return info
	}

	/** Get deleted message info */
	getDeletedMessage(key: WAMessageKey): DeletedMessageInfo | undefined {
		return this.deletedMessages.get(this.getKey(key))
	}

	/** Get all deleted messages */
	getAllDeletedMessages(): DeletedMessageInfo[] {
		return Array.from(this.deletedMessages.values())
	}

	/** Get deleted messages by chat */
	getDeletedMessagesByChat(chatId: string): DeletedMessageInfo[] {
		return Array.from(this.deletedMessages.values()).filter(info => info.key.remoteJid === chatId)
	}

	/** Get all messages in chat */
	getChatMessages(chatId: string): WAMessage[] {
		const chatMessages = this.store.get(chatId)
		if (!chatMessages) return []
		return Array.from(chatMessages.values()).map(s => s.message)
	}

	/** Get chat IDs */
	getChatIds(): string[] {
		return Array.from(this.store.keys())
	}

	/** Get stats */
	getStats(): {
		totalChats: number
		totalMessages: number
		totalDeleted: number
	} {
		let totalMessages = 0
		for (const messages of this.store.values()) {
			totalMessages += messages.size
		}

		return {
			totalChats: this.store.size,
			totalMessages,
			totalDeleted: this.deletedMessages.size
		}
	}

	/** Clear all */
	clear(): void {
		this.store.clear()
		this.deletedMessages.clear()
	}

	/** Clear chat */
	clearChat(chatId: string): void {
		this.store.delete(chatId)
	}

	/** Get all messages in all chats */
	getAllMessages(): { [jid: string]: WAMessage[] } {
		const all: { [jid: string]: WAMessage[] } = {}
		for (const [chatId, messages] of this.store) {
			all[chatId] = Array.from(messages.values()).map(s => s.message)
		}
		return all
	}
}

/** Check whether a message is a delete/revoke message */
export const isDeleteMessage = (message: WAMessage): boolean => {
	const content = message.message
	if (!content) return false

	return content.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE
}

/** Get deleted message key from a revoke message */
export const getDeletedMessageKey = (message: WAMessage): WAMessageKey | null => {
	const protoMsg = message.message?.protocolMessage
	if (protoMsg?.type !== proto.Message.ProtocolMessage.Type.REVOKE) return null

	return protoMsg.key ?? null
}

/**
 * Create anti-delete handler.
 * Wire it to `sock.ev.on('messages.update')`.
 */
export const createAntiDeleteHandler = (store: MessageStore) => {
	return (updates: { key: WAMessageKey; update: Partial<WAMessage> }[]) => {
		const deletedMessages: DeletedMessageInfo[] = []

		for (const { key, update } of updates) {
			if (update.messageStubType === proto.WebMessageInfo.StubType.REVOKE) {
				const deletedInfo = store.markAsDeleted(key, update.messageStubParameters?.[0])
				if (deletedInfo) {
					deletedMessages.push(deletedInfo)
				}
			}
		}

		return deletedMessages
	}
}

/**
 * Create message store handler.
 * Wire it to `sock.ev.on('messages.upsert')`.
 */
export const createMessageStoreHandler = (store: MessageStore) => {
	return ({ messages }: { messages: WAMessage[] }) => {
		const regularMessages = messages.filter(msg => {
			const content = msg.message
			if (!content) return false

			if (content.protocolMessage) return false
			if (content.senderKeyDistributionMessage) return false

			return true
		})

		store.storeMessages(regularMessages)
	}
}
