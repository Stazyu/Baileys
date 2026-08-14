import { proto } from '../../WAProto/index.js'
import type { AuthenticationState, SignalDataTypeMap } from '../Types'
import { initAuthCreds } from './auth-utils'
import { BufferJSON } from './generics'

/**
 * Minimal MongoDB collection surface required by this auth store.
 * Keep this dependency-free so callers can pass any driver (mongodb, mongoose, etc.)
 * that exposes these methods.
 */
export interface MongoAuthCollection {
	findOne(query: { _id: string }): Promise<unknown | null>
	updateOne(
		query: { _id: string },
		update: { $set: { [key: string]: unknown } },
		options: { upsert: boolean }
	): Promise<unknown>
	deleteOne(query: { _id: string }): Promise<unknown>
}

export const useMongoFileAuthState = async (
	collection: MongoAuthCollection
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<unknown> }> => {
	const writeData = (data: unknown, id: string) => {
		const informationToStore = JSON.parse(JSON.stringify(data, BufferJSON.replacer)) as { [key: string]: unknown }
		return collection.updateOne({ _id: id }, { $set: { ...informationToStore } }, { upsert: true })
	}

	const readData = async (id: string) => {
		try {
			const data = await collection.findOne({ _id: id })
			if (!data) return null
			return JSON.parse(JSON.stringify(data), BufferJSON.reviver)
		} catch {
			return null
		}
	}

	const removeData = async (id: string) => {
		try {
			await collection.deleteOne({ _id: id })
		} catch {}
	}

	const creds = (await readData('creds')) || initAuthCreds()

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const data: { [id: string]: SignalDataTypeMap[typeof type] } = {}
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
				set: async data => {
					const tasks: Promise<unknown>[] = []
					for (const category in data) {
						for (const id in data[category as keyof SignalDataTypeMap]) {
							const value = data[category as keyof SignalDataTypeMap]![id]
							const key = `${category}-${id}`
							tasks.push(value ? writeData(value, key) : removeData(key))
						}
					}
					await Promise.all(tasks)
				}
			}
		},
		saveCreds: () => writeData(creds, 'creds')
	}
}
