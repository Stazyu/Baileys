export interface VCardContact {
	/** Full name */
	fullName: string
	/** Display name (optional) */
	displayName?: string
	/** Organization/Company */
	organization?: string
	/** Title/Position */
	title?: string
	/** Phone numbers */
	phones?: Array<{
		number: string
		type?: 'CELL' | 'WORK' | 'HOME' | 'MAIN' | 'FAX' | 'PAGER'
		label?: string
	}>
	/** Email addresses */
	emails?: Array<{
		email: string
		type?: 'WORK' | 'HOME' | 'OTHER'
	}>
	/** Website URLs */
	urls?: Array<{
		url: string
		type?: 'WORK' | 'HOME' | 'OTHER'
	}>
	/** Physical addresses */
	addresses?: Array<{
		street?: string
		city?: string
		state?: string
		postalCode?: string
		country?: string
		type?: 'WORK' | 'HOME' | 'OTHER'
	}>
	/** Birthday (YYYY-MM-DD format) */
	birthday?: string
	/** Notes */
	note?: string
}

const escapeVCard = (str: string) =>
	str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

const formatPhone = (phone: string) => phone.replace(/[^\d+]/g, '')

/** Generate vCard string from contact data */
export const generateVCard = (contact: VCardContact): string => {
	const lines: string[] = []

	lines.push('BEGIN:VCARD')
	lines.push('VERSION:3.0')

	const escapedName = escapeVCard(contact.fullName)
	lines.push(`FN:${escapedName}`)

	const nameParts = contact.fullName.split(' ')
	if (nameParts.length >= 2) {
		const lastName = nameParts[nameParts.length - 1] ?? ''
		const firstName = nameParts.slice(0, -1).join(' ')
		lines.push(`N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`)
	} else {
		lines.push(`N:${escapedName};;;;`)
	}

	if (contact.organization) {
		lines.push(`ORG:${escapeVCard(contact.organization)}`)
	}

	if (contact.title) {
		lines.push(`TITLE:${escapeVCard(contact.title)}`)
	}

	for (const phone of contact.phones ?? []) {
		const type = phone.type ?? 'CELL'
		const formattedPhone = formatPhone(phone.number)
		if (phone.label) {
			lines.push(`TEL;type=${type};type=VOICE;X-ABLabel=${escapeVCard(phone.label)}:${formattedPhone}`)
		} else {
			lines.push(`TEL;type=${type};type=VOICE:${formattedPhone}`)
		}
	}

	for (const email of contact.emails ?? []) {
		const type = email.type ?? 'OTHER'
		lines.push(`EMAIL;type=${type}:${email.email}`)
	}

	for (const url of contact.urls ?? []) {
		const type = url.type ?? 'OTHER'
		lines.push(`URL;type=${type}:${url.url}`)
	}

	for (const addr of contact.addresses ?? []) {
		const type = addr.type ?? 'OTHER'
		const parts = [
			'',
			'',
			addr.street ?? '',
			addr.city ?? '',
			addr.state ?? '',
			addr.postalCode ?? '',
			addr.country ?? ''
		].map(p => escapeVCard(p))
		lines.push(`ADR;type=${type}:${parts.join(';')}`)
	}

	if (contact.birthday) {
		lines.push(`BDAY:${contact.birthday}`)
	}

	if (contact.note) {
		lines.push(`NOTE:${escapeVCard(contact.note)}`)
	}

	lines.push('END:VCARD')
	return lines.join('\r\n')
}

/** Generate multiple vCards (for contact array) */
export const generateVCards = (contacts: VCardContact[]): string => contacts.map(generateVCard).join('\r\n')

/** Parse vCard string to contact data (basic parser) */
export const parseVCard = (vcard: string): Partial<VCardContact> => {
	const contact: Partial<VCardContact> = {}
	const lines = vcard.split(/\r?\n/)

	for (const line of lines) {
		const [key, ...valueParts] = line.split(':')
		if (!key) continue
		const value = valueParts.join(':')

		if (key.startsWith('FN')) {
			contact.fullName = value.replace(/\\([;,n\\])/g, '$1').replace(/\\n/g, '\n')
		} else if (key.startsWith('ORG')) {
			contact.organization = value.replace(/\\([;,n\\])/g, '$1')
		} else if (key.startsWith('TITLE')) {
			contact.title = value.replace(/\\([;,n\\])/g, '$1')
		} else if (key.startsWith('TEL')) {
			contact.phones = contact.phones ?? []
			const typeMatch = key.match(/type=(\w+)/i)
			const phoneType = typeMatch?.[1]?.toUpperCase() ?? 'CELL'
			contact.phones.push({ number: value, type: phoneType as NonNullable<VCardContact['phones']>[number]['type'] })
		} else if (key.startsWith('EMAIL')) {
			contact.emails = contact.emails ?? []
			const typeMatch = key.match(/type=(\w+)/i)
			contact.emails.push({
				email: value,
				type: (typeMatch?.[1]?.toUpperCase() ?? 'OTHER') as NonNullable<VCardContact['emails']>[number]['type']
			})
		} else if (key.startsWith('BDAY')) {
			contact.birthday = value
		} else if (key.startsWith('NOTE')) {
			contact.note = value.replace(/\\n/g, '\n')
		}
	}

	return contact
}

/** Create a simple contact card message content */
export const createContactCard = (contact: VCardContact) => ({
	contacts: {
		displayName: contact.displayName ?? contact.fullName,
		contacts: [{ vcard: generateVCard(contact) }]
	}
})

/** Create an array of contact cards message content */
export const createContactCards = (contacts: VCardContact[]) => {
	const firstContact = contacts[0]
	return {
		contacts: {
			displayName:
				contacts.length === 1 && firstContact
					? (firstContact.displayName ?? firstContact.fullName)
					: `${contacts.length} Contacts`,
			contacts: contacts.map(c => ({ vcard: generateVCard(c) }))
		}
	}
}

/** Quick helper to create contact from phone number */
export const quickContact = (
	name: string,
	phone: string,
	options?: { organization?: string; email?: string }
): VCardContact => ({
	fullName: name,
	phones: [{ number: phone, type: 'CELL' }],
	organization: options?.organization,
	emails: options?.email ? [{ email: options.email, type: 'WORK' }] : undefined
})
