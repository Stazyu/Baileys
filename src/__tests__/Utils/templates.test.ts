import { describe, expect, it } from '@jest/globals'
import { createTemplateManager, renderTemplate, TemplateManager } from '../../Utils/templates'

describe('TemplateManager', () => {
	it('extracts required and defaulted variables', () => {
		const manager = new TemplateManager()
		const template = manager.create({ name: 'Greeting', content: 'Hi {{name}}, code {{code:ABC}}!' })
		expect(template.variables).toEqual([
			{ name: 'name', defaultValue: undefined, required: true },
			{ name: 'code', defaultValue: 'ABC', required: false }
		])
	})

	it('renders with values and falls back to defaults', () => {
		const manager = new TemplateManager()
		manager.create({ name: 'Greeting', content: 'Hi {{name}}, code {{code:ABC}}!' })
		expect(manager.renderContent('Hi {{name}}, code {{code:ABC}}!', { name: 'Zoe' })).toBe('Hi Zoe, code ABC!')
	})

	it('validates missing required variables', () => {
		const manager = new TemplateManager()
		const template = manager.create({ name: 'Greeting', content: 'Hi {{name}}' })
		expect(manager.validate(template.id, {})).toEqual({ valid: false, missing: ['name'] })
		expect(manager.validate(template.id, { name: 'Zoe' })).toEqual({ valid: true, missing: [] })
	})
})

describe('renderTemplate', () => {
	it('interpolates standalone content', () => {
		expect(renderTemplate('Hello {{name}}', { name: 'Ada' })).toBe('Hello Ada')
	})

	it('leaves unknown variables untouched', () => {
		expect(renderTemplate('Hello {{name}}', {})).toBe('Hello {{name}}')
	})
})

describe('createTemplateManager', () => {
	it('seeds preset templates when requested', () => {
		const manager = createTemplateManager(true)
		expect(manager.get('order_confirmation')).toBeDefined()
	})

	it('starts empty without presets', () => {
		const manager = createTemplateManager(false)
		expect(manager.getAll()).toHaveLength(0)
	})
})
