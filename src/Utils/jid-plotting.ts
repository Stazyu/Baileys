import {
	type JidServer,
	jidDecode,
	jidEncode,
	jidNormalizedUser,
	isHostedLidUser,
	isHostedPnUser,
	isLidUser,
	isPnUser
} from '../WABinary'
import type { AuthenticationCreds } from '../Types'

export interface JidInfo {
	/** Full JID string */
	jid: string
	/** User part (phone number or LID) */
	user: string
	/** Server/domain part */
	server: string
	/** Device number (0 = primary) */
	device: number
	/** Agent (0 = user, 1 = agent) */
	agent: number
	/** Is this a LID? */
	isLid: boolean
	/** Is this a phone number (PN)? */
	isPn: boolean
	/** Is this a hosted account? */
	isHosted: boolean
	/** Is this a group? */
	isGroup: boolean
	/** Is this a newsletter? */
	isNewsletter: boolean
	/** Normalized user (without device) */
	normalizedUser: string
}

export interface PlottedJid {
	/** Original JID given */
	original: string
	/** Phone number JID */
	pn?: string
	/** LID */
	lid?: string
	/** Resolved (primary identifier) */
	primary: string
	/** Full info */
	info: JidInfo
}

export interface SenderPnInfo {
	/** Phone number with @s.whatsapp.net */
	phoneJid: string
	/** Phone number without domain */
	phoneNumber: string
	/** LID if available */
	lid?: string
	/** Device ID */
	deviceId: number
	/** Name stored on the account */
	pushName?: string
	/** Platform (android/ios/web/etc) */
	platform?: string
}

/** Parse and extract full info from a JID */
export const parseJid = (jid: string): JidInfo | null => {
	if (!jid) return null

	const decoded = jidDecode(jid)
	if (!decoded) return null

	const isLid = !!isLidUser(jid) || !!isHostedLidUser(jid)
	const isPn = !!isPnUser(jid) || !!isHostedPnUser(jid)
	const isGroup = jid.endsWith('@g.us')
	const isNewsletter = jid.endsWith('@newsletter')
	const isHosted = jid.includes('@hosted') || !!isHostedLidUser(jid) || !!isHostedPnUser(jid)

	return {
		jid,
		user: decoded.user,
		server: decoded.server,
		device: decoded.device ?? 0,
		agent: 0,
		isLid,
		isPn,
		isHosted,
		isGroup,
		isNewsletter,
		normalizedUser: jidNormalizedUser(jid)
	}
}

/** Get senderPn (current session phone number) from AuthenticationCreds */
export const getSenderPn = (creds: AuthenticationCreds): SenderPnInfo | null => {
	if (!creds?.me?.id) return null

	const decoded = jidDecode(creds.me.id)
	if (!decoded) return null

	const phoneNumber = decoded.user
	const phoneJid = `${phoneNumber}@s.whatsapp.net`

	return {
		phoneJid,
		phoneNumber,
		lid: creds.me.lid ?? undefined,
		deviceId: decoded.device ?? 0,
		pushName: creds.me.name,
		platform: creds.platform
	}
}

/** Get current sender info from authState */
export const getCurrentSenderInfo = (authState: { creds: AuthenticationCreds }): SenderPnInfo | null =>
	getSenderPn(authState.creds)

/** Check whether a JID is the current sender */
export const isSelf = (jid: string, senderPn: SenderPnInfo): boolean => {
	if (!jid || !senderPn) return false

	const normalizedJid = jidNormalizedUser(jid)
	const normalizedSelf = jidNormalizedUser(senderPn.phoneJid)

	if (normalizedJid === normalizedSelf) return true

	if (senderPn.lid) {
		const normalizedLid = jidNormalizedUser(senderPn.lid)
		if (normalizedJid === normalizedLid) return true
	}

	return false
}

/** Plot JID — identify whether it is a PN or LID */
export const plotJid = (jid: string): PlottedJid | null => {
	const info = parseJid(jid)
	if (!info) return null

	const result: PlottedJid = {
		original: jid,
		primary: jid,
		info
	}

	if (info.isPn) {
		result.pn = info.normalizedUser
		result.primary = info.normalizedUser
	} else if (info.isLid) {
		result.lid = info.normalizedUser
		result.primary = info.normalizedUser
	}

	return result
}

/** Normalize various number formats to a valid JID */
export const normalizePhoneToJid = (phone: string): string => {
	const cleaned = phone.replace(/[^\d@]/g, '')

	if (phone.includes('@')) {
		return jidNormalizedUser(phone)
	}

	return `${cleaned}@s.whatsapp.net`
}

/** Extract phone number from JID (without domain) */
export const extractPhoneNumber = (jid: string): string | null => {
	const info = parseJid(jid)
	if (!info || !info.isPn) return null
	return info.user
}

/** Build a formatted display string for a JID */
export const formatJidDisplay = (
	jid: string,
	options?: {
		showDevice?: boolean
		showType?: boolean
	}
): string => {
	const info = parseJid(jid)
	if (!info) return jid

	let display = info.user

	if (options?.showDevice && info.device > 0) {
		display += `:${info.device}`
	}

	if (options?.showType) {
		if (info.isLid) display += ' (LID)'
		else if (info.isGroup) display += ' (Group)'
		else if (info.isNewsletter) display += ' (Newsletter)'
		else if (info.isPn) display += ' (PN)'
	}

	return display
}

/** Compare two JIDs to check whether they refer to the same user */
export const isSameUser = (jid1: string, jid2: string): boolean => {
	const info1 = parseJid(jid1)
	const info2 = parseJid(jid2)

	if (!info1 || !info2) return false

	return info1.normalizedUser === info2.normalizedUser
}

/** Get all JID variants of a single number */
export const getJidVariants = (phone: string): string[] => {
	const cleaned = phone.replace(/[^\d]/g, '')

	return [
		`${cleaned}@s.whatsapp.net`,
		`${cleaned}:0@s.whatsapp.net`,
		`${cleaned}@lid`,
		`${cleaned}:1@s.whatsapp.net`,
		`${cleaned}:2@s.whatsapp.net`
	]
}

/** Construct a JID with a device ID */
export const constructJidWithDevice = (user: string, device: number, server: JidServer = 's.whatsapp.net'): string => {
	if (device === 0) {
		return jidEncode(user, server)
	}
	return jidEncode(user, server, device)
}

/** Get the correct remoteJid from a message, accounting for groups and direct chats */
export const getRemoteJidFromMessage = (msg: {
	key: { remoteJid?: string; participant?: string }
}): { chatJid: string; senderJid: string } | null => {
	if (!msg?.key?.remoteJid) return null

	const chatJid = msg.key.remoteJid
	const isGroupMsg = chatJid.endsWith('@g.us')

	const senderJid = isGroupMsg ? (msg.key.participant ?? chatJid) : chatJid

	return { chatJid, senderJid }
}

export interface JidPlotterWithMapping {
	plotToLid: (pn: string) => Promise<string | null>
	plotToPn: (lid: string) => Promise<string | null>
	plotBidirectional: (jid: string) => Promise<PlottedJid>
}

/** Create a plotter that can resolve LID <-> PN via external mapping */
export const createJidPlotter = (
	getLIDForPN: (pn: string) => Promise<string | null>,
	getPNForLID: (lid: string) => Promise<string | null>
): JidPlotterWithMapping => ({
	plotToLid: async (pn: string) => await getLIDForPN(pn),

	plotToPn: async (lid: string) => await getPNForLID(lid),

	plotBidirectional: async (jid: string) => {
		const info = parseJid(jid)
		if (!info) {
			return {
				original: jid,
				primary: jid,
				info: parseJid(jid)!
			}
		}

		const result: PlottedJid = {
			original: jid,
			primary: jid,
			info
		}

		if (info.isPn) {
			result.pn = info.normalizedUser
			const lid = await getLIDForPN(jid)
			if (lid) result.lid = lid
			result.primary = info.normalizedUser
		} else if (info.isLid) {
			result.lid = info.normalizedUser
			const pn = await getPNForLID(jid)
			if (pn) result.pn = pn
			result.primary = result.pn ?? info.normalizedUser
		}

		return result
	}
})
