import { Boom } from '@hapi/boom'
import type { SocketConfig } from '../Types'
import { USyncQuery, USyncUser } from '../WAUSync'
import { executeWMexQuery as genericExecuteWMexQuery } from './mex'
import { makeBusinessSocket } from './business'

export const USERNAME_QUERY_IDS = {
	CHECK: '26124072630599520',
	CHECK_MULTI: '27134626522840290',
	SET: '27108705368767936',
	GET: '32618050064506056',
	GET_RECOMMENDATIONS: '26077456248616956',
	PIN_SET: '25529696019976770'
} as const

export const USERNAME_CHECK_RESULT = {
	SUCCESS: 'SUCCESS',
	INVALID: 'INVALID'
} as const

export const USERNAME_SOURCE = {
	FB: 'FB',
	IG: 'IG',
	USER_INPUT: 'USER_INPUT',
	SUGGESTION: 'SUGGESTION'
} as const

export const makeUsernameSocket = (config: SocketConfig) => {
	const sock = makeBusinessSocket(config)
	const { query, generateMessageTag, executeUSyncQuery } = sock

	const mexQuery = <T>(variables: Record<string, unknown>, queryId: string, dataPath: string): Promise<T> =>
		genericExecuteWMexQuery<T>(variables, queryId, dataPath, query, generateMessageTag)

	const checkUsername = async (username: string, includeSuggestions = true) => {
		const data = await mexQuery<{
			result?: string
			suggestions?: string[]
			rejection_reasons?: string[]
			suggestions_eligible?: boolean
		}>({ username, include_suggestions: includeSuggestions }, USERNAME_QUERY_IDS.CHECK, 'xwa2_username_check')

		if (data?.result === USERNAME_CHECK_RESULT.SUCCESS) {
			return { available: true, username }
		}

		return {
			available: false,
			username,
			suggestions: data?.suggestions ?? [],
			rejectionReasons: data?.rejection_reasons ?? [],
			suggestionsEligible: data?.suggestions_eligible ?? true
		}
	}

	const checkUsernameMulti = (usernames: string[]) =>
		mexQuery({ usernames }, USERNAME_QUERY_IDS.CHECK_MULTI, 'xwa2_username_check_multi')

	const setUsername = (
		username: string,
		options: { source?: 'FB' | 'IG' | 'USER_INPUT' | 'SUGGESTION'; sessionId?: string; pin?: string } = {}
	) => {
		const { source = USERNAME_SOURCE.USER_INPUT, sessionId, pin } = options
		const variables = {
			username,
			reserved: false,
			source,
			...(sessionId ? { session_id: sessionId } : {}),
			...(pin ? { pin } : {})
		}
		return mexQuery(variables, USERNAME_QUERY_IDS.SET, 'xwa2_username_set')
	}

	const deleteUsername = () => mexQuery({ username: null }, USERNAME_QUERY_IDS.SET, 'xwa2_username_delete')

	const getMyUsername = async (): Promise<string | null> => {
		const data = await mexQuery<{ username?: string }>({}, USERNAME_QUERY_IDS.GET, 'xwa2_username_get')
		return data?.username ?? null
	}

	const getUsernameRecommendations = (source: string | null = null) => {
		const variables: Record<string, unknown> = {}
		if (source) variables.source = source
		return mexQuery(variables, USERNAME_QUERY_IDS.GET_RECOMMENDATIONS, 'xwa2_username_get_recommendations')
	}

	const setUsernamePin = (pin: string | null) => mexQuery({ pin }, USERNAME_QUERY_IDS.PIN_SET, 'xwa2_username_pin_set')

	const findUserByUsername = async (username: string, pin?: string) => {
		const usyncQuery = new USyncQuery().withContactProtocol()
		const user = new USyncUser().withUsername(username)
		if (pin) user.withUsernameKey(pin)
		usyncQuery.withUser(user)

		const result = await executeUSyncQuery(usyncQuery)
		if (!result?.list?.length) return null

		const entry = result.list[0]!
		return {
			jid: entry.id,
			contact: entry.contact ?? false
		}
	}

	const fetchContactUsernames = async (...jids: string[]) => {
		const usyncQuery = new USyncQuery().withUsernameProtocol()
		for (const jid of jids) {
			usyncQuery.withUser(new USyncUser().withId(jid))
		}
		const result = await executeUSyncQuery(usyncQuery)
		if (!result) {
			throw new Boom('Failed to fetch contact usernames', { statusCode: 502 })
		}
		return result.list.map(entry => ({ id: entry.id, username: (entry.username as string | null) ?? null }))
	}

	return {
		...sock,
		checkUsername,
		checkUsernameMulti,
		setUsername,
		deleteUsername,
		getMyUsername,
		getUsernameRecommendations,
		setUsernamePin,
		findUserByUsername,
		fetchContactUsernames,
		USERNAME_QUERY_IDS,
		USERNAME_CHECK_RESULT,
		USERNAME_SOURCE
	}
}

export type UsernameSocket = ReturnType<typeof makeUsernameSocket>
