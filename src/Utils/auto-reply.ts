import type { AnyMessageContent, WAMessage } from '../Types'

/** A single auto-reply rule */
export interface AutoReplyRule {
	id: string
	/** Keywords to match (case-insensitive substring match) */
	keywords?: string[]
	/** Regex pattern to match */
	pattern?: RegExp
	/** Exact text match (case-insensitive) */
	exactMatch?: string
	/** Static reply content, or a function returning content dynamically */
	response:
		| AnyMessageContent
		| ((message: WAMessage, match: RegExpMatchArray | null) => AnyMessageContent | Promise<AnyMessageContent>)
	/** Only allow replies to these JIDs */
	allowedJids?: string[]
	/** Block replies to these JIDs */
	blockedJids?: string[]
	/** Only reply in groups */
	groupsOnly?: boolean
	/** Only reply in private chats */
	privateOnly?: boolean
	/** Per-rule cooldown in ms */
	cooldown?: number
	/** Quote the original message in the reply */
	quoted?: boolean
	/** Whether this rule is active (default: true) */
	active?: boolean
	/** Priority — higher number = checked first (default: 0) */
	priority?: number
}

/** Options for the AutoReplyHandler */
export interface AutoReplyOptions {
	/** Minimum time between replies to any JID in ms (default: 1000) */
	globalCooldown?: number
	/**
	 * Show a "typing..." composing indicator before sending each reply.
	 * Requires `sendPresence` to be passed to `createAutoReply`.
	 */
	simulateTyping?: boolean
	/** How long to show the typing indicator in ms (default: 1000) */
	typingDuration?: number
	/** Send a reply for every matching rule (default: false — first match only) */
	multiMatch?: boolean
	/** Called after each auto-reply is sent */
	onReply?: (rule: AutoReplyRule, message: WAMessage, response: AnyMessageContent) => void
	/** Called when a rule's reply throws an error */
	onError?: (error: Error, rule: AutoReplyRule, message: WAMessage) => void
}

export type AutoReplySendFunction = (
	jid: string,
	content: AnyMessageContent,
	options?: { quoted?: WAMessage }
) => Promise<WAMessage | undefined>

export type PresenceFunction = (jid: string, presence: 'composing' | 'paused') => Promise<void>

/** Keyword/pattern-based automatic reply handler */
export class AutoReplyHandler {
	private rules = new Map<string, AutoReplyRule>()
	private cooldowns = new Map<string, number>()
	private globalCooldown = new Map<string, number>()

	private sendMessage: AutoReplySendFunction
	private sendPresence?: PresenceFunction
	private options: Required<AutoReplyOptions>

	constructor(sendMessage: AutoReplySendFunction, sendPresence?: PresenceFunction, options: AutoReplyOptions = {}) {
		this.sendMessage = sendMessage
		this.sendPresence = sendPresence
		this.options = {
			globalCooldown: options.globalCooldown ?? 1000,
			simulateTyping: options.simulateTyping ?? false,
			typingDuration: options.typingDuration ?? 1000,
			multiMatch: options.multiMatch ?? false,
			onReply: options.onReply ?? (() => {}),
			onError: options.onError ?? (() => {})
		}
	}

	private generateId() {
		return `ar_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
	}

	/** Add a rule. Must have at least one of: keywords, pattern, exactMatch */
	addRule(rule: Omit<AutoReplyRule, 'id'> & { id?: string }): AutoReplyRule {
		const fullRule: AutoReplyRule = {
			...rule,
			id: rule.id ?? this.generateId(),
			active: rule.active ?? true,
			priority: rule.priority ?? 0
		}

		if (!fullRule.keywords && !fullRule.pattern && !fullRule.exactMatch) {
			throw new Error('Rule must have at least one of: keywords, pattern, or exactMatch')
		}

		this.rules.set(fullRule.id, fullRule)
		return fullRule
	}

	/** Remove a rule by ID */
	removeRule(id: string): boolean {
		return this.rules.delete(id)
	}

	/** List all rules */
	getRules(): AutoReplyRule[] {
		return Array.from(this.rules.values())
	}

	/** Get a rule by ID */
	getRule(id: string): AutoReplyRule | undefined {
		return this.rules.get(id)
	}

	/** Enable or disable a rule */
	setRuleActive(id: string, active: boolean): boolean {
		const rule = this.rules.get(id)
		if (rule) {
			rule.active = active
			return true
		}
		return false
	}

	/** Remove all rules */
	clearRules(): void {
		this.rules.clear()
	}

	private checkCooldown(ruleId: string, jid: string): boolean {
		const lastTime = this.cooldowns.get(`${ruleId}:${jid}`) ?? 0
		return Date.now() - lastTime >= 0
	}

	private checkGlobalCooldown(jid: string): boolean {
		const lastTime = this.globalCooldown.get(jid) ?? 0
		return Date.now() - lastTime > this.options.globalCooldown
	}

	private setCooldown(ruleId: string, jid: string, cooldown: number): void {
		this.cooldowns.set(`${ruleId}:${jid}`, Date.now() + cooldown)
		this.globalCooldown.set(jid, Date.now())
	}

	private matchRule(text: string, rule: AutoReplyRule): RegExpMatchArray | string[] | null {
		if (!rule.active) return null

		if (rule.exactMatch) {
			if (text.toLowerCase() === rule.exactMatch.toLowerCase()) {
				return [text]
			}
		}

		if (rule.keywords && rule.keywords.length > 0) {
			const lower = text.toLowerCase()
			for (const kw of rule.keywords) {
				if (lower.includes(kw.toLowerCase())) return [kw]
			}
		}

		if (rule.pattern) {
			return text.match(rule.pattern)
		}

		return null
	}

	private isJidAllowed(jid: string, rule: AutoReplyRule): boolean {
		const isGroup = jid.endsWith('@g.us')
		const isNewsletter = jid.endsWith('@newsletter')

		if (isNewsletter) return false
		if (rule.groupsOnly && !isGroup) return false
		if (rule.privateOnly && isGroup) return false

		if (rule.allowedJids && rule.allowedJids.length > 0) {
			if (!rule.allowedJids.includes(jid)) return false
		}
		if (rule.blockedJids && rule.blockedJids.includes(jid)) {
			return false
		}

		return true
	}

	/**
	 * Process an incoming WAMessage and auto-reply if a rule matches.
	 * @returns true if at least one reply was sent
	 */
	async processMessage(message: WAMessage): Promise<boolean> {
		const messageContent = message.message
		if (!messageContent) return false

		const text =
			messageContent.conversation ??
			messageContent.extendedTextMessage?.text ??
			messageContent.imageMessage?.caption ??
			messageContent.videoMessage?.caption ??
			messageContent.documentMessage?.caption ??
			''

		if (!text) return false

		const jid = message.key.remoteJid
		if (!jid) return false

		if (!this.checkGlobalCooldown(jid)) return false

		const sortedRules = Array.from(this.rules.values())
			.filter(r => r.active)
			.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

		let matched = false

		for (const rule of sortedRules) {
			if (!this.isJidAllowed(jid, rule)) continue
			if (rule.cooldown && !this.checkCooldown(rule.id, jid)) continue

			const match = this.matchRule(text, rule)
			if (!match) continue

			try {
				let response: AnyMessageContent
				if (typeof rule.response === 'function') {
					response = await rule.response(message, match as RegExpMatchArray | null)
				} else {
					response = rule.response
				}

				if (this.options.simulateTyping && this.sendPresence) {
					await this.sendPresence(jid, 'composing')
					await new Promise(r => setTimeout(r, this.options.typingDuration))
					await this.sendPresence(jid, 'paused')
				}

				await this.sendMessage(jid, response, rule.quoted ? { quoted: message } : undefined)

				if (rule.cooldown) {
					this.setCooldown(rule.id, jid, rule.cooldown)
				}

				this.options.onReply(rule, message, response)
				matched = true

				if (!this.options.multiMatch) break
			} catch (error) {
				this.options.onError(error as Error, rule, message)
			}
		}

		return matched
	}
}

/** Create an AutoReplyHandler wired to your socket's sendMessage/sendPresenceUpdate */
export const createAutoReply = (
	sendMessage: AutoReplySendFunction,
	sendPresence?: PresenceFunction,
	options?: AutoReplyOptions
): AutoReplyHandler => new AutoReplyHandler(sendMessage, sendPresence, options)
