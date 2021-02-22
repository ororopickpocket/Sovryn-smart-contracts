'''
test script for testing the loan token lending logic with wBTC as collateral token and the sUSD test token as underlying loan token. 
NOTE: NO DIFFERENCE TO USING TEST TOKENS
1. Lending / Minting
2. Cashing Out / Burning
3. Cashing out / Burning more than available
'''

import pytest
from brownie import Contract, Wei, reverts
from fixedint import *
import shared
from loanToken.lending.shared_lending_functions import *

'''
Test lend to the pool. The lender mint tokens from loanToken using SUSD as deposit.
Then check if user balance change and the token price varies
'''
def test_lend_to_the_pool(loanToken, accounts, SUSD, WRBTC, chain, set_demand_curve, sovryn):
    lend_to_the_pool(loanToken, accounts, SUSD, WRBTC, chain, set_demand_curve, sovryn)

'''
1. lend to the pool
2. check balance and supply
3. withdraw from the pool by burning iTokens
4. check balance and supply
'''
def test_cash_out_from_the_pool(loanToken, accounts, SUSD):
    lendBTC = False #lend tokens and not direct rbtc
    cash_out_from_the_pool(loanToken, accounts, SUSD, lendBTC)
    
'''
try to burn more than I'm possessing. should burn the maximum possible amount.
'''
def test_cash_out_from_the_pool_more_of_lender_balance_should_not_fail(loanToken, accounts, SUSD):
    cash_out_from_the_pool_more_of_lender_balance_should_not_fail(loanToken, accounts, SUSD)

