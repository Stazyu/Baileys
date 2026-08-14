import { proto } from '../../WAProto/index.js'
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '../Types'
import type { CacheStore } from '../Types'
import { initAuthCreds } from '../Utils/auth-utils'
import { BufferJSON } from '../Utils/generics'

/**
 * Backs an auth state with any `CacheStore`-compatible cache
 * (e.g. `@cacheable/node-cache`, Redis, or a `cache-manager` store wrapped to the
 * upstream `CacheStore` interface).
 */
export const makeCacheManagerAuthState = async (
	store: CacheStore,
	sessionKey: string
): Promise<{
	clearState: () => Promise<void>
	saveCreds: () => Promise<void>
	state: AuthenticationState
}> => {
	const defaultKey = (file: string) => `${sessionKey}:${file}`

	const writeData = async (file: string, data: unknown) => {
		await store.set(defaultKey(file), JSON.stringify(data, BufferJSON.replacer) as never)
	}

	const readData = async (file: string) => {
		try {
			const data = await store.get<string>(defaultKey(file))
			if (data) {
				return JSON.parse(data, BufferJSON.reviver)
			}
			return null
		} catch {
			return null
		}
	}

	const removeData = async (file: string) => {
		try {
			return await store.del(defaultKey(file))
		} catch {
			return undefined
		}
	}

	const clearState = async () => {
		await store.flushAll()
	}

	const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds()

	return {
		clearState,
		saveCreds: async () => writeData('creds', creds),
		state: {
			creds,
			keys: {
				get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
					const data: { [id: string]: SignalDataTypeMap[T] } = {}
					await Promise.all(
						ids.map(async id => {
							let value = await readData(`${type}-${id}`)
							if (type === 'app-state-sync-key' && value) {
								value = proto.Message.AppStateSyncKeyData.fromObject(value)
							}
							data[id] = value
						})
					)
					return data
				},
				set: async (data: { [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] | null } }) => {
					const tasks: Promise<unknown>[] = []
					for (const category in data) {
						for (const id in data[category as keyof SignalDataTypeMap]) {
							const value = data[category as keyof SignalDataTypeMap]![id]
							const key = `${category}-${id}`
							tasks.push(value ? writeData(key, value) : removeData(key))
						}
					}
					await Promise.all(tasks)
				}
			}
		}
	}
}
