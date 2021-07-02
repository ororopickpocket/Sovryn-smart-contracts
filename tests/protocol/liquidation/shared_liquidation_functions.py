'''
shared functions for the liquidation tests
'''

import pytest
from brownie import reverts
from fixedint import *
from loanToken.sov_reward import verify_sov_reward_payment


def liquidate(accounts, loanToken, underlyingToken, set_demand_curve, collateralToken, sovryn, priceFeeds, rate, WRBTC,
              FeesEvents, SOV, chain):
    # set the demand curve to set interest rates
    set_demand_curve()
    
    lender = accounts[0]
    borrower = accounts[1]
    liquidator = accounts[2]
    loan_token_sent = 10e18
    
    # lend to the pool, mint tokens if required, open a margin trade position
    loan_id = prepare_liquidation(lender, borrower, liquidator, loan_token_sent, loanToken, underlyingToken, collateralToken, sovryn, WRBTC)
    loan = sovryn.getLoan(loan_id).dict()

    # set the rates so we're able to liquidate
    if(underlyingToken == WRBTC):
        priceFeeds.setRates(underlyingToken.address, collateralToken.address, rate)
        value = loan_token_sent
    else:
        priceFeeds.setRates(collateralToken.address, underlyingToken.address, rate)
        value = 0

    sov_borrower_initial_balance = SOV.balanceOf(borrower)

    chain.sleep(10*24*60*60)  # time travel 10 days
    chain.mine(1)

    # liquidate
    tx_liquidation = sovryn.liquidate(loan_id, liquidator, loan_token_sent, {'from': liquidator, 'value' :value})
    
    verify_liquidation_event(loan, tx_liquidation, lender, borrower, liquidator, loan_token_sent, loanToken, underlyingToken, set_demand_curve, collateralToken, sovryn, priceFeeds, rate)
    if(underlyingToken != WRBTC):
        verify_sov_reward_payment(tx_liquidation, FeesEvents, SOV, borrower, loan_id, sov_borrower_initial_balance, 1)


'''
should fail to liquidate a healthy position
'''
def liquidate_healthy_position_should_fail(accounts, loanToken, underlyingToken, set_demand_curve, collateralToken, sovryn, priceFeeds, WRBTC):
    # set the demand curve to set interest rates
    set_demand_curve()
    
    lender = accounts[0]
    borrower = accounts[1]
    liquidator = accounts[2]
    loan_token_sent = 10e18
    
    # lend to the pool, mint tokens if required, open a margin trade position
    loan_id = prepare_liquidation(lender, borrower, liquidator, loan_token_sent, loanToken, underlyingToken, collateralToken, sovryn, WRBTC)
    
    # try to liquidate the still healthy position
    
    with reverts("healthy position"):
        sovryn.liquidate(loan_id, lender, loan_token_sent)


'''
lend to the pool, mint tokens if required, open a margin trade position
'''
def prepare_liquidation(lender, borrower, liquidator, loan_token_sent, loanToken, underlyingToken, collateralToken, sovryn, WRBTC):
    underlyingToken.approve(loanToken.address, 1e40)
    
    if (WRBTC == underlyingToken):
        loanToken.mintWithBTC(lender, {'value': 1e21})
        value = loan_token_sent
    else:
        loanToken.mint(lender, 1e21)
        underlyingToken.mint(borrower, loan_token_sent)
        underlyingToken.mint(liquidator, loan_token_sent)
        underlyingToken.approve(loanToken.address, loan_token_sent, {'from': borrower})
        underlyingToken.approve(sovryn.address, loan_token_sent, {'from': liquidator})
        value = 0

    tx = loanToken.marginTrade(
        "0",  # loanId  (0 for new loans)
        2e18,  # leverageAmount
        loan_token_sent,  # loanTokenSent
        0,  # no collateral token sent
        collateralToken.address,  # collateralTokenAddress
        borrower,  # trader,
        0,  # minReturn
        b'',  # loanDataBytes (only required with ether)
        {'from': borrower, 'value': value}
    )

    return tx.events['Trade']['loanId']

'''
compute the expected values and make sure the event contains them
'''
def verify_liquidation_event(loan, tx_liquidation, lender, borrower, liquidator, loan_token_sent, loanToken, underlyingToken, set_demand_curve, collateralToken, sovryn, priceFeeds, rate):
    loan_id = loan['loanId']
    collateral_ = loan['collateral']
    principal_ = loan['principal']

    (current_margin, collateral_to_loan_rate) = priceFeeds.getCurrentMargin(
        underlyingToken.address,
        collateralToken.address,
        principal_,
        collateral_
    )
    liquidation_incentive_percent = sovryn.liquidationIncentivePercent()
    maintenance_margin = loan['maintenanceMargin']

    desired_margin = fixedint(maintenance_margin).add(5e18)
    max_liquidatable = fixedint(desired_margin).add(1e20).mul(principal_).div(1e20)
    max_liquidatable = max_liquidatable.sub(fixedint(collateral_).mul(collateral_to_loan_rate).div(1e18))
    max_liquidatable = max_liquidatable.mul(1e20).div(fixedint(desired_margin).sub(liquidation_incentive_percent))
    max_liquidatable = fixedint(principal_) if max_liquidatable > principal_ else max_liquidatable

    max_seizable = fixedint(max_liquidatable).mul(fixedint(liquidation_incentive_percent).add(1e20))
    max_seizable = max_seizable.div(collateral_to_loan_rate).div(100)
    max_seizable = collateral_ if (max_seizable > collateral_) else max_seizable

    loan_close_amount = max_liquidatable if (loan_token_sent > max_liquidatable.num) else loan_token_sent
    collateral_withdraw_amount = fixedint(max_seizable).mul(loan_close_amount).div(max_liquidatable)

    liquidate_event = tx_liquidation.events['Liquidate']
    assert(liquidate_event['user'] == borrower)
    assert(liquidate_event['liquidator'] == liquidator)
    assert(liquidate_event['loanId'] == loan_id)
    assert(liquidate_event['lender'] == loanToken.address)
    assert(liquidate_event['loanToken'] == underlyingToken.address)
    assert(liquidate_event['collateralToken'] == collateralToken.address)
    
    print('repayAmount', liquidate_event['repayAmount'])
    print('loan_token_sent', loan_token_sent)
    assert(liquidate_event['repayAmount'] == loan_token_sent)
    assert(liquidate_event['collateralWithdrawAmount'] == collateral_withdraw_amount)
    assert(liquidate_event['collateralToLoanRate'] == collateral_to_loan_rate)
    assert(liquidate_event['currentMargin'] == current_margin)
