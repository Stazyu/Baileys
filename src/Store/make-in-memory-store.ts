import { existsSync, readFileSync, writeFileSync } from 'fs'
import { proto } from '../../WAProto/index.js'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults'
import type { Chat } from '../Types/Chat'
import type { BaileysEventEmitter, ConnectionState } from '../Types'
import type { Contact } from '../Types/Contact'
import type { GroupMetadata, GroupParticipant } from '../Types/GroupMetadata'
import type { Label } from '../Types/Label'
import { LabelAssociationType, type LabelAssociation } from '../Types/LabelAssociation'
import type { PresenceData } from '../Types/Chat'
import type { WAMessage, WAMessageCursor, WAMessageKey } from '../Types/Message'
import { toNumber, updateMessageWithReceipt, updateMessageWithReaction } from '../Utils'
import { jidNormalizedUser } from '../WABinary'
import { makeOrderedDictionary, type OrderedDictionary } from './make-ordered-dictionary'
import { ObjectRepository } from './object-repository'

export interface Comparable<T, K = string> {
	key: (item: T) => K
	compare: (k1: K, k2: K) => number
}

const waChatKey = (pin: boolean): Comparable<Chat> => ({
	key: c =>
		(pin ? (c.pinned ? '1' : '0') : '') +
		(c.archived ? '0' : '1') +
		(c.conversationTimestamp ? toNumber(c.conversationTimestamp).toString(16).padStart(8, '0') : '') +
		c.id,
	compare: (k1, k2) => k2.localeCompare(k1)
})

const waMessageID = (m: WAMessage): string => m.key.id ?? ''

const waLabelAssociationKey: Comparable<LabelAssociation> = {
	key: la => (la.type === LabelAssociationType.Chat ? la.chatId + la.labelId : la.chatId + la.messageId + la.labelId),
	compare: (k1, k2) => k2.localeCompare(k1)
}

export type BaileysInMemoryStoreConfig = {
	chatKey?: Comparable<Chat>
	labelAssociationKey?: Comparable<LabelAssociation>
	logger?: typeof DEFAULT_CONNECTION_CONFIG.logger
	socket?: {
		profilePictureUrl?: (jid: string, type?: 'preview' | 'image') => Promise<string | undefined>
		groupMetadata?: (jid: string) => Promise<GroupMetadata>
	}
}

/** Minimal in-memory ordered keyed store, used to avoid an external KeyedDB dependency */
const makeKeyedStore = <T>(comparable: Comparable<T>) => {
	const items: T[] = []
	const get = (key: string): T | undefined => items.find(i => comparable.key(i) === key)

	const upsert = (...newItems: T[]) => {
		for (const item of newItems) {
			const idx = items.findIndex(i => comparable.key(i) === comparable.key(item))
			if (idx >= 0) {
				items[idx] = item
			} else {
				items.push(item)
			}
		}
		items.sort((a, b) => comparable.compare(comparable.key(a), comparable.key(b)))
		return items
	}

	const insertIfAbsent = (...newItems: T[]) => {
		const added: T[] = []
		for (const item of newItems) {
			if (!get(comparable.key(item))) {
				items.push(item)
				added.push(item)
			}
		}
		items.sort((a, b) => comparable.compare(comparable.key(a), comparable.key(b)))
		return added
	}

	const update = (key: string, updater: (item: T) => void): boolean => {
		const item = get(key)
		if (!item) return false
		updater(item)
		return true
	}

	const deleteById = (key: string): boolean => {
		const idx = items.findIndex(i => comparable.key(i) === key)
		if (idx >= 0) {
			items.splice(idx, 1)
			return true
		}
		return false
	}

	const filter = (predicate: (item: T) => boolean): T[] => {
		const result: T[] = []
		for (let i = items.length - 1; i >= 0; i--) {
			if (predicate(items[i]!)) {
				result.push(items[i]!)
			} else {
				items.splice(i, 1)
			}
		}
		return result
	}

	const all = (): T[] => items
	const clear = () => items.splice(0, items.length)

	return { get, upsert, insertIfAbsent, update, deleteById, filter, all, clear, array: items }
}

const makeMessagesDictionary = () => makeOrderedDictionary<WAMessage>(waMessageID)

export const makeInMemoryStore = (config: BaileysInMemoryStoreConfig) => {
	const socket = config.socket
	const chatKey = config.chatKey ?? waChatKey(true)
	const labelAssociationKey = config.labelAssociationKey ?? waLabelAssociationKey
	const logger = config.logger ?? DEFAULT_CONNECTION_CONFIG.logger.child({ stream: 'in-mem-store' })

	const chats = makeKeyedStore<Chat>(chatKey)
	const messages: { [jid: string]: OrderedDictionary<WAMessage> } = {}
	const contacts: { [id: string]: Contact } = {}
	const groupMetadata: { [id: string]: GroupMetadata } = {}
	const presences: { [id: string]: { [participant: string]: PresenceData } } = {}
	const state: ConnectionState = { connection: 'close' }
	const labels = new ObjectRepository<Label>()
	const labelAssociations = makeKeyedStore<LabelAssociation>(labelAssociationKey)
	const lidMappings: { [id: string]: string } = {}

	const assertMessageList = (jid: string | null | undefined): OrderedDictionary<WAMessage> => {
		const key = jidNormalizedUser(jid ?? undefined)
		if (!messages[key]) {
			messages[key] = makeMessagesDictionary()
		}
		return messages[key]!
	}

	const contactsUpsert = (newContacts: Contact[]): Set<string> => {
		const oldContacts = new Set(Object.keys(contacts))
		for (const contact of newContacts) {
			oldContacts.delete(contact.id)
			contacts[contact.id] = Object.assign(contacts[contact.id] || {}, contact)
		}
		return oldContacts
	}

	const labelsUpsert = (newLabels: Label[]) => {
		for (const label of newLabels) {
			labels.upsertById(label.id, label)
		}
	}

	const bind = (ev: BaileysEventEmitter) => {
		ev.on('connection.update', update => {
			Object.assign(state, update)
		})
		ev.on(
			'messaging-history.set',
			({ chats: newChats, contacts: newContacts, messages: newMessages, isLatest, syncType }) => {
				if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
					return
				}
				if (isLatest) {
					chats.clear()
					for (const id in messages) {
						delete messages[id]
					}
				}
				const chatsAdded = chats.insertIfAbsent(...newChats).length
				logger.debug({ chatsAdded }, 'synced chats')
				const oldContacts = contactsUpsert(newContacts)
				if (isLatest) {
					for (const jid of oldContacts) {
						delete contacts[jid]
					}
				}
				for (const msg of newMessages) {
					const list = assertMessageList(msg.key.remoteJid)
					list.upsert(msg, 'prepend')
				}
				logger.debug({ messages: newMessages.length }, 'synced messages')
			}
		)
		ev.on('contacts.upsert', contacts => {
			contactsUpsert(contacts)
		})
		ev.on('contacts.update', updates => {
			for (const update of updates) {
				if (contacts[update.id!]) {
					Object.assign(contacts[update.id!]!, update)
				} else {
					logger.debug({ update }, 'got update for non-existant contact')
				}
			}
		})
		ev.on('chats.upsert', newChats => {
			chats.upsert(...newChats)
		})
		ev.on('chats.update', updates => {
			for (let update of updates) {
				const result = chats.update(update.id!, chat => {
					const incomingUnread = update.unreadCount ?? 0
					if (incomingUnread > 0) {
						update = { ...update }
						update.unreadCount = (chat.unreadCount ?? 0) + incomingUnread
					}
					Object.assign(chat, update)
				})
				if (!result) {
					logger.debug({ update }, 'got update for non-existant chat')
				}
			}
		})
		ev.on('labels.edit', label => {
			if (label.deleted) {
				return labels.deleteById(label.id)
			}
			if (labels.count() < 20) {
				return labels.upsertById(label.id, label)
			}
			logger.error('Labels count exceed')
		})
		ev.on('labels.association', ({ type, association }) => {
			switch (type) {
				case 'add':
					labelAssociations.upsert(association)
					break
				case 'remove':
					labelAssociations.deleteById(labelAssociationKey.key(association))
					break
			}
		})
		ev.on('presence.update', ({ id, presences: update }) => {
			presences[id] = presences[id] || {}
			Object.assign(presences[id], update)
		})
		ev.on('chats.delete', deletions => {
			for (const item of deletions) {
				if (chats.get(item)) {
					chats.deleteById(item)
				}
			}
		})
		ev.on('messages.upsert', ({ messages: newMessages, type }) => {
			switch (type) {
				case 'append':
				case 'notify':
					for (const msg of newMessages) {
						const jid = jidNormalizedUser(msg.key.remoteJid ?? undefined)
						const list = assertMessageList(jid)
						list.upsert(msg, 'append')
						if (type === 'notify' && !chats.get(jid)) {
							ev.emit('chats.upsert', [
								{
									id: jid,
									conversationTimestamp: toNumber(msg.messageTimestamp),
									unreadCount: 1
								}
							])
						}
					}
					break
			}
		})
		ev.on('messages.update', updates => {
			for (const { update, key } of updates) {
				const list = assertMessageList(key.remoteJid)
				if (update?.status) {
					const listStatus = list.get(key.id!)?.status
					if (listStatus && update.status <= listStatus) {
						logger.debug({ update, storedStatus: listStatus }, 'status stored newer then update')
						delete update.status
					}
				}
				const result = list.updateAssign(key.id!, update)
				if (!result) {
					logger.debug({ update }, 'got update for non-existent message')
				}
			}
		})
		ev.on('messages.delete', item => {
			if ('all' in item) {
				messages[item.jid]?.clear()
			} else {
				const jid = item.keys[0]?.remoteJid
				const list = jid ? messages[jid] : undefined
				if (list) {
					const idSet = new Set(item.keys.map(k => k.id))
					list.filter(m => !idSet.has(m.key.id))
				}
			}
		})
		ev.on('groups.upsert', newGroups => {
			for (const group of newGroups) {
				groupMetadata[group.id] = group
				logger.debug({ id: group.id }, 'group metadata upserted')
			}
		})
		ev.on('groups.update', updates => {
			for (const update of updates) {
				const id = update.id
				if (id && groupMetadata[id]) {
					Object.assign(groupMetadata[id], update)
				} else {
					logger.debug({ update }, 'got update for non-existant group metadata')
				}
			}
		})
		ev.on('group-participants.update', ({ id, participants, action }) => {
			const metadata = groupMetadata[id]
			if (!metadata) return

			const toParticipant = (p: GroupParticipant): GroupParticipant => ({
				id: p.id ?? p.phoneNumber ?? '',
				phoneNumber: p.phoneNumber,
				lid: p.lid,
				admin: p.admin ?? null,
				notify: p.notify
			})

			switch (action) {
				case 'add':
					metadata.participants.push(...participants.map(toParticipant))
					break
				case 'promote':
					for (const participant of metadata.participants) {
						if (participants.some(p => (p.id ?? p.phoneNumber) === participant.id)) {
							participant.admin = 'admin'
						}
					}
					break
				case 'demote':
					for (const participant of metadata.participants) {
						if (participants.some(p => (p.id ?? p.phoneNumber) === participant.id)) {
							participant.admin = null
						}
					}
					break
				case 'remove': {
					const removeIds = participants.map(p => p.id ?? p.phoneNumber)
					metadata.participants = metadata.participants.filter(p => !removeIds.includes(p.id))
					break
				}
			}
		})
		ev.on('lid-mapping.update', ({ lid, pn }) => {
			lidMappings[lid] = pn
			lidMappings[pn] = lid
			logger.debug({ lid, pn }, 'lid mapping updated in store')
		})
		ev.on('message-receipt.update', updates => {
			for (const { key, receipt } of updates) {
				const msg = messages[key.remoteJid!]?.get(key.id!)
				if (msg) {
					updateMessageWithReceipt(msg, receipt)
				}
			}
		})
		ev.on('messages.reaction', reactions => {
			for (const { key, reaction } of reactions) {
				const msg = messages[key.remoteJid!]?.get(key.id!)
				if (msg) {
					updateMessageWithReaction(msg, reaction)
				}
			}
		})
	}

	const toJSON = () => ({
		chats: chats.all(),
		contacts,
		messages: Object.fromEntries(Object.entries(messages).map(([jid, list]) => [jid, list.toJSON()])),
		labels: labels.toJSON(),
		labelAssociations: labelAssociations.all(),
		lidMappings
	})

	const fromJSON = (json: {
		chats: Chat[]
		contacts: { [id: string]: Contact }
		messages: { [id: string]: WAMessage[] }
		labels: Label[]
		labelAssociations: LabelAssociation[]
	}) => {
		chats.upsert(...(json.chats ?? []))
		labelAssociations.upsert(...(json.labelAssociations ?? []))
		contactsUpsert(Object.values(json.contacts ?? {}))
		labelsUpsert(json.labels ?? [])
		for (const jid in json.messages ?? {}) {
			const list = assertMessageList(jid)
			for (const msg of json.messages[jid]!) {
				list.upsert(proto.WebMessageInfo.fromObject(msg) as WAMessage, 'append')
			}
		}
	}

	return {
		chats,
		contacts,
		messages,
		groupMetadata,
		state,
		presences,
		labels,
		labelAssociations,
		bind,
		loadMessages: async (jid: string, count: number, cursor: WAMessageCursor) => {
			const list = assertMessageList(jid)
			const mode = !cursor || 'before' in cursor ? 'before' : 'after'
			const cursorKey = cursor ? ('before' in cursor ? cursor.before : cursor.after) : undefined
			const cursorValue = cursorKey ? list.get(cursorKey.id!) : undefined
			let msgs: WAMessage[]
			if (mode === 'before' && (!cursorKey || cursorValue)) {
				if (cursorValue) {
					const msgIdx = list.array.findIndex(m => m.key.id === cursorKey?.id)
					msgs = list.array.slice(0, msgIdx)
				} else {
					msgs = list.array
				}
				const diff = count - msgs.length
				if (diff < 0) {
					msgs = msgs.slice(-count)
				}
			} else {
				msgs = []
			}
			return msgs
		},
		getLabels: () => labels,
		getChatLabels: (chatId: string) => labelAssociations.filter(la => la.chatId === chatId),
		getMessageLabels: (messageId: string) =>
			labelAssociations
				.filter(la => la.type === LabelAssociationType.Message && la.messageId === messageId)
				.map(({ labelId }) => labelId),
		loadMessage: async (jid: string, id: string) => messages[jid]?.get(id),
		mostRecentMessage: async (jid: string) => messages[jid]?.array.slice(-1)[0],
		fetchImageUrl: async (jid: string) => {
			const contact = contacts[jid]
			if (!contact) {
				return socket?.profilePictureUrl?.(jid)
			}
			if (typeof contact.imgUrl === 'undefined') {
				contact.imgUrl = await socket?.profilePictureUrl?.(jid)
			}
			return contact.imgUrl
		},
		fetchGroupMetadata: async (jid: string) => {
			if (!groupMetadata[jid]) {
				const metadata = await socket?.groupMetadata?.(jid)
				if (metadata) {
					groupMetadata[jid] = metadata
				}
			}
			return groupMetadata[jid]
		},
		fetchMessageReceipts: async ({ remoteJid, id }: WAMessageKey) => {
			const msg = messages[remoteJid!]?.get(id!)
			return msg?.userReceipt
		},
		getMessage: async (key: WAMessageKey) => {
			const jid = jidNormalizedUser(key.remoteJid ?? undefined)
			const msg = messages[jid]?.get(key.id!)
			return msg?.message ?? undefined
		},
		getAllMessages: () => messages,
		toJSON,
		fromJSON,
		writeToFile: (path: string) => {
			writeFileSync(path, JSON.stringify(toJSON()))
		},
		readFromFile: (path: string) => {
			if (existsSync(path)) {
				logger.debug({ path }, 'reading from file')
				fromJSON(JSON.parse(readFileSync(path, { encoding: 'utf-8' })))
			}
		}
	}
}
