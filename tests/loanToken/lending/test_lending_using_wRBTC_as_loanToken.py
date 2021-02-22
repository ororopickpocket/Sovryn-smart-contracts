'''
test script for testing the loan token lending logic with the sUSD test token as collateral token and wBTC as underlying loan token. 
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
def test_lend_to_the_pool(loanTokenWRBTC, accounts, SUSD, WRBTC, chain, set_demand_curve, sovryn):
    # set the demand curve to set interest rates
    set_demand_curve()
    
    #set the params
    lender = accounts[0]
    deposit_amount = 4e18
    loan_token_sent = 1e18
    total_deposit_amount = fixedint(deposit_amount).add(loan_token_sent)
    initial_balance = 0 # dummy value to be able to use the shared functions
    actual_initial_balance = lender.balance() 
    
    #check the start conditions are met
    verify_start_conditions(WRBTC, loanTokenWRBTC, lender, initial_balance, deposit_amount)
    
    #supply funds to the pool (the actual lending)
    loanTokenWRBTC.mintWithBTC(lender, {'value':deposit_amount})
    
    #verify the result
    initial_balance = 5e18 # dummy value to be able to use the shared functions
    verify_lending_result_and_itoken_price_change(accounts, WRBTC, SUSD, loanTokenWRBTC, lender, loan_token_sent, initial_balance, deposit_amount, chain, sovryn, True)
    new_balance = lender.balance() 
    assert(new_balance < actual_initial_balance)
    
'''
1. lend to the pool
2. check balance and supply
3. withdraw from the pool by burning iTokens
4. check balance and supply
'''
def test_cash_out_from_the_pool(loanTokenWRBTC, accounts, WRBTC):
    lendBTC = True
    cash_out_from_the_pool(loanTokenWRBTC, accounts, WRBTC, lendBTC)
    
'''
try to burn more than I'm possessing. should burn the maximum possible amount.
'''
def test_cash_out_from_the_pool_more_of_lender_balance_should_not_fail(loanTokenWRBTC, accounts, SUSD):
    lender = accounts[0]
    total_deposit_amount = 200e18
    loanTokenWRBTC.mintWithBTC(lender, {'value':total_deposit_amount})
    balance_after_lending = lender.balance()
    loanTokenWRBTC.burnToBTC(lender, total_deposit_amount * 2)
    assert(loanTokenWRBTC.balanceOf(lender) == 0)
