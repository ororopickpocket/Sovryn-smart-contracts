'''
test script for testing the loan token trading logic with wBTC as collateral token and the sUSD test token as underlying loan token. 
1. opening a margin trade position with loan tokens
2. opening a margin trade position with collateral tokens
3. closing a margin trade position completely
4. closing a margin trade position partially
'''

import pytest
from loanToken.trading.shared_trading_functions import *

'''
tests margin trading sending loan tokens.
process is handled by the shared function margin_trading_sending_loan_tokens
1. approve the transfer
2. send the margin trade tx
3. verify the trade event and balances are correct
4. retrieve the loan from the smart contract and make sure all values are set as expected
'''
def test_margin_trading_sending_loan_tokens(accounts, sovryn, loanToken, SUSD, WRBTC, priceFeeds, chain, SOV, FeesEvents):
    margin_trading_sending_loan_tokens(accounts, sovryn, loanToken, 1e19, SUSD, WRBTC, priceFeeds, chain, False)
    margin_trading_sov_reward_payment(accounts, loanToken, 1e19, SUSD, WRBTC, chain, SOV, FeesEvents)

'''
tests margin trading sending collateral tokens as collateral. 
process:
1. send the margin trade tx with the passed parameter (NOTE: the token transfer needs to be approved already)
2. TODO verify the trade event and balances are correct
'''     
def test_margin_trading_sending_collateral_tokens(accounts, sovryn, loanToken, SUSD, WRBTC, chain, FeesEvents, SOV, priceFeeds):
    loanSize = 10000e18
    SUSD.mint(loanToken.address, loanSize*12)
    collateralTokenSent = sovryn.getRequiredCollateral(SUSD.address, WRBTC.address, loanSize*2, 50e18, False)
    leverageAmount = 5e18
    margin_trading_sending_collateral_tokens(accounts, sovryn, loanToken, SUSD, WRBTC, loanSize, collateralTokenSent,
                                             leverageAmount, collateralTokenSent, priceFeeds)
    WRBTC.mint(accounts[2], collateralTokenSent)
    WRBTC.approve(loanToken.address, collateralTokenSent, {'from': accounts[2]})
    margin_trading_sending_collateral_tokens_sov_reward_payment(accounts[2], loanToken, WRBTC, collateralTokenSent,
                                                                leverageAmount, 0, chain, FeesEvents, SOV)

'''
should completely close a position.
first with returning loan tokens, then with returning collateral tokens to the sender.
process is handled by the shared function close_complete_margin_trade
1. prepares the test by setting up the interest rates, lending to the pool and opening a position
2. travels in time, so interest needs to be paid
3. makes sure closing with an unauthorized caller fails (only the trader may close his position)
4. sends the closing tx from the trader
5. verifies the result
'''
@pytest.mark.parametrize('return_token_is_collateral', [False, True])
def test_close_complete_margin_trade(sovryn, loanToken, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral):
    close_complete_margin_trade(sovryn, loanToken, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral)

'''
should partially close a position.
first with returning loan tokens, then with returning collateral tokens to the sender.
process is handled by the shared function close_partial_margin_trade
1. prepares the test by setting up the interest rates, lending to the pool and opening a position
2. travels in time, so interest needs to be paid
3. makes sure closing with an unauthorized caller fails (only the trader may close his position)
4. sends the closing tx from the trader
5. verifies the result
'''
@pytest.mark.parametrize('return_token_is_collateral', [False, True])
def test_close_partial_margin_trade(sovryn, loanToken, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral):
    close_partial_margin_trade(sovryn, loanToken, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral)


