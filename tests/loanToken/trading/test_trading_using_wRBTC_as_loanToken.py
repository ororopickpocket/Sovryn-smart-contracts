'''
test script for testing the loan token trading logic with the sUSD test token as collateral token and wBTC as underlying loan token. 
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
def test_margin_trading_sending_loan_tokens(accounts, sovryn, loanTokenWRBTC, SUSD, WRBTC, priceFeeds, chain, SOV, FeesEvents):
    margin_trading_sending_loan_tokens(accounts, sovryn, loanTokenWRBTC, 1e18, WRBTC, SUSD, priceFeeds, chain, True)
    margin_trading_sov_reward_payment(accounts, loanTokenWRBTC, 1e18, WRBTC, SUSD, chain, SOV, FeesEvents)

'''
tests margin trading sending collateral tokens as collateral. 
process:
1. send the margin trade tx with the passed parameter (NOTE: the token transfer needs to be approved already)
2. TODO verify the trade event and balances are correct
'''     
def test_margin_trading_sending_collateral_tokens(accounts, sovryn, loanTokenWRBTC, SUSD, WRBTC, chain, FeesEvents, SOV, priceFeeds):
    loanSize = 1e18
    # make sure there are sufficient funds on the contract
    loanTokenWRBTC.mintWithBTC(accounts[0], {'value':loanSize*6})
    loanTokenWRBTC.mintWithBTC(accounts[2], {'value':loanSize*6})
    #compute the amount of collateral tokens needed
    collateralTokenSent = sovryn.getRequiredCollateral(WRBTC.address, SUSD.address, loanSize*2, 50e18, False)
    SUSD.mint(accounts[0], collateralTokenSent)
    SUSD.mint(accounts[2], collateralTokenSent)
    #important! WRBTC is being held by the loanToken contract itself, all other tokens are transfered directly from
    #the sender and need approval
    SUSD.approve(loanTokenWRBTC.address, collateralTokenSent)
    SUSD.approve(loanTokenWRBTC.address, collateralTokenSent, {'from': accounts[2]})
    leverageAmount = 5e18
    value = 0
    margin_trading_sending_collateral_tokens(accounts, sovryn, loanTokenWRBTC, WRBTC, SUSD, loanSize,
                                             collateralTokenSent, leverageAmount, value, priceFeeds)
    margin_trading_sending_collateral_tokens_sov_reward_payment(accounts[2], loanTokenWRBTC, SUSD, collateralTokenSent,
                                                                leverageAmount, value, chain, FeesEvents, SOV)

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
def test_close_complete_margin_trade(sovryn, loanTokenWRBTC, web3, set_demand_curve, lend_to_pool_iBTC, open_margin_trade_position_iBTC, priceFeeds, chain, return_token_is_collateral):
    close_complete_margin_trade(sovryn, loanTokenWRBTC, web3, set_demand_curve, lend_to_pool_iBTC, open_margin_trade_position_iBTC, priceFeeds, chain, return_token_is_collateral)

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
'''
@pytest.mark.parametrize('return_token_is_collateral', [False, True])
def test_close_partial_margin_trade(sovryn, loanTokenWRBTC, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral):
    close_partial_margin_trade(sovryn, loanTokenWRBTC, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral)
'''

