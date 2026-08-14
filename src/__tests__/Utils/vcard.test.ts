import { describe, expect, it } from '@jest/globals'
import { createContactCard, generateVCard, generateVCards, parseVCard, quickContact } from '../../Utils/vcard'

describe('generateVCard', () => {
	it('emits a 3.0 vCard with FN and N lines', () => {
		const vcard = generateVCard({ fullName: 'John Doe' })
		expect(vcard).toContain('BEGIN:VCARD')
		expect(vcard).toContain('VERSION:3.0')
		expect(vcard).toContain('FN:John Doe')
		expect(vcard).toContain('END:VCARD')
	})

	it('escapes separators and folds multi-part names', () => {
		const vcard = generateVCard({ fullName: 'Doe; John', organization: 'ACME, Inc' })
		expect(vcard).toContain('FN:Doe\\; John')
		expect(vcard).toContain('ORG:ACME\\, Inc')
	})

	it('emits typed phone numbers', () => {
		const vcard = generateVCard({ fullName: 'Jane', phones: [{ number: '+1 (555) 123-4567', type: 'CELL' }] })
		expect(vcard).toContain('TEL;type=CELL;type=VOICE:+15551234567')
	})
})

describe('parseVCard', () => {
	it('round-trips full name and organization', () => {
		const source = generateVCard({ fullName: 'Ada Lovelace', organization: 'Analytical Engines' })
		const parsed = parseVCard(source)
		expect(parsed.fullName).toBe('Ada Lovelace')
		expect(parsed.organization).toBe('Analytical Engines')
	})
})

describe('generateVCards', () => {
	it('joins multiple vCards with CRLF', () => {
		const cards = generateVCards([{ fullName: 'A' }, { fullName: 'B' }])
		expect(cards.split('END:VCARD').length).toBe(3)
	})
})

describe('createContactCard', () => {
	it('wraps a vcard in a contacts message shape', () => {
		const content = createContactCard({ fullName: 'Zoe' })
		expect(content.contacts.displayName).toBe('Zoe')
		expect(content.contacts.contacts[0]!.vcard).toContain('FN:Zoe')
	})
})

describe('quickContact', () => {
	it('builds a minimal contact from a name and phone', () => {
		const contact = quickContact('Zoe', '+1 555 1234', { email: 'zoe@example.com' })
		expect(contact.fullName).toBe('Zoe')
		expect(contact.phones![0]!.number).toBe('+1 555 1234')
		expect(contact.emails![0]!.email).toBe('zoe@example.com')
	})
})
