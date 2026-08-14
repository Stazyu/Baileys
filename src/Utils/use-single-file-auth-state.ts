import { existsSync, readFileSync, writeFileSync } from 'fs'
import { proto } from '../../WAProto/index.js'
import type { AuthenticationState, SignalDataTypeMap } from '../Types'
import { initAuthCreds } from './auth-utils'
import { BufferJSON } from './generics'
import type { ILogger } from './logger'

// Backwards-compatibility key map — do not use in new systems
const KEY_MAP: { [T in keyof SignalDataTypeMap]: string } = {
	'pre-key': 'preKeys',
	session: 'sessions',
	'sender-key': 'senderKeys',
	'app-state-sync-key': 'appStateSyncKeys',
	'app-state-sync-version': 'appStateVersions',
	'sender-key-memory': 'senderKeyMemory',
	'lid-mapping': 'lidMappings',
	'device-list': 'deviceLists',
	tctoken: 'tcTokens',
	'identity-key': 'identityKeys'
}

/**
 * @deprecated use multi file auth state instead
 * Stores the full authentication state in a single JSON file.
 * Only meant to serve as an example, not for production use.
 */
export const useSingleFileAuthState = (
	filename: string,
	logger?: ILogger
): { state: AuthenticationState; saveState: () => void } => {
	let creds = initAuthCreds()
	let keys: { [_: string]: { [id: string]: unknown } } = {}

	const saveState = () => {
		logger?.trace('saving auth state')
		writeFileSync(filename, JSON.stringify({ creds, keys }, BufferJSON.replacer, 2))
	}

	if (existsSync(filename)) {
		const result = JSON.parse(readFileSync(filename, { encoding: 'utf-8' }), BufferJSON.reviver) as {
			creds: AuthenticationState['creds']
			keys: typeof keys
		}
		creds = result.creds
		keys = result.keys
	}

	return {
		state: {
			creds,
			keys: {
				get: (type, ids) => {
					const key = KEY_MAP[type]
					return ids.reduce<{ [id: string]: SignalDataTypeMap[typeof type] }>((dict, id) => {
						let value = keys[key]?.[id]
						if (value) {
							if (type === 'app-state-sync-key') {
								value = proto.Message.AppStateSyncKeyData.fromObject(value)
							}
							dict[id] = value as SignalDataTypeMap[typeof type]
						}
						return dict
					}, {})
				},
				set: data => {
					for (const _key in data) {
						const key = KEY_MAP[_key as keyof SignalDataTypeMap]
						keys[key] = keys[key] ?? {}
						Object.assign(keys[key], data[_key as keyof SignalDataTypeMap])
					}
					saveState()
				}
			}
		},
		saveState
	}
}
