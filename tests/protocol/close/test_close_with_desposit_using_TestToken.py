'''
Tests the close with deposit. 
Note: close with swap is tested in loanToken/trading

1. Test a full closure with deposit
2. Test a partial closure with deposit
3. Should fail to close with 0 deposit 
'''

import pytest
from brownie import reverts
from fixedint import *
from helpers import decode_log
from loanToken.sov_reward import verify_sov_reward_payment
import shared

"""
Test CloseWithDeposit event parameters
Test refund collateral to receiver
Test refund interest to receiver
Test loan update
Test returning principal to lender with deposit
"""
def test_full_close_with_deposit(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position, SUSD, RBTC,
                                 loanToken, priceFeeds, chain, accounts, LoanClosingsEvents, FeesEvents, SOV):

    borrower = accounts[3]
    receiver = accounts[4]

    set_demand_curve()
    (_, _) = lend_to_pool(lender=accounts[2])
    (loan_id, trader, loan_token_sent, leverage_amount) = open_margin_trade_position(trader=borrower)

    chain.sleep(10*24*60*60)  # time travel 10 days
    chain.mine(1)

    initial_loan = sovryn.getLoan(loan_id)
    principal = initial_loan['principal']
    collateral = initial_loan['collateral']
    initial_loan_interest = sovryn.getLoanInterestData(loan_id)

    deposit_amount = principal

    internal_test_close_with_deposit(deposit_amount, RBTC, SUSD, borrower, chain, collateral, initial_loan,
                                     initial_loan_interest, loanToken, loan_id, priceFeeds, principal, receiver,
                                     sovryn, LoanClosingsEvents, FeesEvents, SOV)


"""
Test CloseWithDeposit event parameters
Test refund collateral to receiver
Test refund interest to receiver
Test loan update
Test returning principal to lender with deposit
"""
def test_partial_close_with_deposit(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position, SUSD, RBTC,
                                    loanToken, priceFeeds, chain, accounts, LoanClosingsEvents, FeesEvents, SOV):

    borrower = accounts[3]
    receiver = accounts[4]

    set_demand_curve()
    (_, _) = lend_to_pool(lender=accounts[2])
    (loan_id, trader, loan_token_sent, leverage_amount) = open_margin_trade_position(trader=borrower)

    chain.sleep(10*24*60*60)  # time travel 10 days
    chain.mine(1)

    initial_loan = sovryn.getLoan(loan_id)
    principal = initial_loan['principal']
    collateral = initial_loan['collateral']
    initial_loan_interest = sovryn.getLoanInterestData(loan_id)

    deposit_amount = principal // 2
    internal_test_close_with_deposit(deposit_amount, RBTC, SUSD, borrower, chain, collateral, initial_loan,
                                     initial_loan_interest, loanToken, loan_id, priceFeeds, principal, receiver,
                                     sovryn, LoanClosingsEvents, FeesEvents, SOV)

"""
Test CloseWithDeposit event parameters
Test refund collateral to receiver
Test refund interest to receiver
Test loan update
Test returning principal to lender with deposit
"""
def test_partial_close_with_deposit_tiny_position(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position, SUSD, RBTC,
                                    loanToken, priceFeeds, chain, accounts, LoanClosingsEvents, FeesEvents, SOV):

    borrower = accounts[3]
    receiver = accounts[4]

    set_demand_curve()
    (_, _) = lend_to_pool(lender=accounts[2])
    (loan_id, trader, loan_token_sent, leverage_amount) = open_margin_trade_position(trader=borrower)

    chain.sleep(10*24*60*60)  # time travel 10 days
    chain.mine(1)

    initial_loan = sovryn.getLoan(loan_id)
    principal = initial_loan['principal']
    collateral = initial_loan['collateral']
    initial_loan_interest = sovryn.getLoanInterestData(loan_id)

    # amount to check that tiny position won't be created
    constants = shared.Constants()
    deposit_amount = principal - constants.TINY_AMOUNT
    internal_test_close_with_deposit(deposit_amount, RBTC, SUSD, borrower, chain, collateral, initial_loan,
                                     initial_loan_interest, loanToken, loan_id, priceFeeds, principal, receiver,
                                     sovryn, LoanClosingsEvents, FeesEvents, SOV)

"""
Test CloseWithDeposit event parameters
Test refund collateral to receiver
Test refund interest to receiver
Test loan update
Test returning principal to lender with deposit
"""
def test_partial_close_with_swap_tiny_position(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position, SUSD, RBTC,
                                                  loanToken, priceFeeds, chain, accounts, LoanClosingsEvents, FeesEvents, SOV):

    borrower = accounts[3]
    receiver = accounts[4]

    set_demand_curve()
    (_, _) = lend_to_pool(lender=accounts[2])
    (loan_id, trader, loan_token_sent, leverage_amount) = open_margin_trade_position(trader=borrower)

    chain.sleep(10*24*60*60)  # time travel 10 days
    chain.mine(1)

    initial_loan = sovryn.getLoan(loan_id)
    principal = initial_loan['principal']
    collateral = initial_loan['collateral']
    initial_loan_interest = sovryn.getLoanInterestData(loan_id)

    # amount to check that tiny position won't be created
    constants = shared.Constants()
    swap_amount = collateral - constants.TINY_AMOUNT

    tx = sovryn.closeWithSwap(loan_id, receiver, swap_amount, True, "", {'from': borrower})
    tx.info()

    # Test loan update
    end_loan = sovryn.getLoan(loan_id)
    assert end_loan['principal'] == 0
    assert end_loan['collateral'] == 0

def test_close_with_zero_deposit_should_fail(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position, chain, accounts):
    borrower = accounts[3]
    receiver = accounts[4]

    set_demand_curve()
    (_, _) = lend_to_pool(lender=accounts[2])
    (loan_id, trader, loan_token_sent, leverage_amount) = open_margin_trade_position(trader=borrower)

    chain.sleep(10*24*60*60)  # time travel 10 days
    chain.mine(1)

    with reverts("depositAmount == 0"):
        sovryn.closeWithDeposit(loan_id, receiver, 0, {'from': borrower})


def internal_test_close_with_deposit(deposit_amount, RBTC, SUSD, borrower, chain, collateral, initial_loan,
                                     initial_loan_interest, loanToken, loan_id, priceFeeds, principal, receiver,
                                     sovryn, LoanClosingsEvents, FeesEvents, SOV):
    SUSD.mint(borrower, deposit_amount)
    SUSD.approve(sovryn.address, deposit_amount, {'from': borrower})
    (rate, precision) = priceFeeds.queryRate(initial_loan['collateralToken'], initial_loan['loanToken'])

    sov_borrower_initial_balance = SOV.balanceOf(borrower)

    tx = sovryn.closeWithDeposit(loan_id, receiver, deposit_amount, {'from': borrower})
    tx.info()

    loan_close_amount = principal if deposit_amount > principal else deposit_amount
    # check that tiny position won't be created
    constants = shared.Constants()
    loan_close_amount = principal if principal - loan_close_amount <= constants.TINY_AMOUNT else loan_close_amount
    withdraw_amount = collateral if loan_close_amount == principal \
        else fixedint(collateral).mul(loan_close_amount).div(principal).num
    end_collateral = collateral - withdraw_amount
    end_principal = 0 if loan_close_amount == principal else principal - loan_close_amount
    collateral_to_loan_rate = fixedint(rate).mul(10 ** 18).div(precision).num
    collateral_to_loan_amount = fixedint(end_collateral).mul(collateral_to_loan_rate).div(10 ** 18).num
    current_margin = fixedint(collateral_to_loan_amount - end_principal).mul(10 ** 20).div(end_principal) \
        if (end_principal <= collateral_to_loan_amount and end_principal != 0) else 0

    owed_per_day = initial_loan_interest['interestOwedPerDay']
    end_timestamp = initial_loan['endTimestamp']
    owed_per_day_refund = fixedint(owed_per_day).mul(loan_close_amount).div(principal).num
    # (loan end timestamp - block timestamp) * owedPerDayRefund / 24*60*60
    interest_refund_to_borrower_1 = fixedint(end_timestamp - chain[-1].timestamp).mul(owed_per_day_refund).div(
        24 * 60 * 60).num
    interest_refund_to_borrower = 0 if interest_refund_to_borrower_1 <= loan_close_amount \
        else interest_refund_to_borrower_1 - loan_close_amount

    # Test CloseWithDeposit event parameters
    # When all the tests are run, the event is not recognized so we have to decode it manually
    close_event = tx.events['CloseWithDeposit'] if 'CloseWithDeposit' in tx.events \
        else decode_log(tx, LoanClosingsEvents, 'CloseWithDeposit')
    assert (close_event['user'] == borrower)
    assert (close_event['lender'] == loanToken.address)
    assert (close_event['loanId'] == loan_id)
    assert (close_event['closer'] == borrower)
    assert (close_event['loanToken'] == initial_loan['loanToken'])
    assert (close_event['collateralToken'] == initial_loan['collateralToken'])
    assert (close_event['repayAmount'] == loan_close_amount)
    assert (close_event['collateralWithdrawAmount'] == withdraw_amount)
    assert (close_event['collateralToLoanRate'] == collateral_to_loan_rate)
    assert (close_event['currentMargin'] == current_margin)

    # Test refund collateral to receiver
    # Test refund interest to receiver
    assert (RBTC.balanceOf(receiver) == withdraw_amount)
    assert (SUSD.balanceOf(receiver) == interest_refund_to_borrower)

    # Test loan update
    end_loan = sovryn.getLoan(loan_id)
    new_principal = 0 if loan_close_amount == principal else fixedint(principal).sub(loan_close_amount).num
    assert (end_loan['principal'] == new_principal)
    if loan_close_amount == principal:
        last_block_timestamp = chain[-1]['timestamp']
        assert (end_loan['endTimestamp'] <= last_block_timestamp)

    # Test returning principal to lender with deposit
    loan_close_amount_less_interest = loan_close_amount - interest_refund_to_borrower_1 \
        if loan_close_amount >= interest_refund_to_borrower_1 \
        else 0
    transfer_to_lender = list(filter(lambda tx_event: tx_event['from'] == borrower, tx.events['Transfer']))
    assert (len(transfer_to_lender) == 1)
    transfer_to_lender = transfer_to_lender[0]
    assert (transfer_to_lender['to'] == loanToken.address)
    assert (transfer_to_lender['value'] == loan_close_amount_less_interest)

    verify_sov_reward_payment(tx, FeesEvents, SOV, borrower, loan_id, sov_borrower_initial_balance, 1)
