import {encodeFunctionData, type Address} from 'viem'
import {exchangeAbi} from './orders'

export const creditReadData = (owner: string) => encodeFunctionData({
  abi: exchangeAbi, functionName: 'credits', args: [owner as Address],
})
export const creditWithdrawData = () => encodeFunctionData({abi: exchangeAbi, functionName: 'withdrawCredits'})
