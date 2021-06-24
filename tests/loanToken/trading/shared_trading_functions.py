'''
shared functions for the trading tests
'''

import pytest
from brownie import Contract, Wei, reverts
from fixedint import *
import shared
from loanToken.sov_reward import verify_sov_reward_payment

'''
makes a margin trade sending loan tokens as collateral. therefore, not just the loan, but the complete position needs to be swapped.
process:
1. approve the transfer
2. send the margin trade tx
3. verify the trade event and balances are correct
4. retrieve the loan from the smart contract and make sure all values are set as expected
'''
def margin_trading_sending_loan_tokens(accounts, sovryn, loanToken, loan_token_sent, underlyingToken, collateralToken, priceFeeds, chain, sendValue):
    # preparation
    underlyingToken.mint(loanToken.address, loan_token_sent*3)
    underlyingToken.mint(accounts[0], loan_token_sent)
    underlyingToken.approve(loanToken.address, loan_token_sent)
    value = loan_token_sent if sendValue else 0
    
    # send the transaction
    leverage_amount = 2e18
    collateral_sent = 0
    tx = loanToken.marginTrade(
        "0", #loanId  (0 for new loans)
        leverage_amount, # leverageAmount
        loan_token_sent, #loanTokenSent
        collateral_sent, # no collateral token sent
        collateralToken.address, #collateralTokenAddress
        accounts[0], #trader,
        b'', #loanDataBytes (only required with ether)
        {'value': value}
    )
    
    # check the balances and the trade event
    sovryn_after_collateral_token_balance = collateralToken.balanceOf(sovryn.address)
    loantoken_after_underlying_token_balance = underlyingToken.balanceOf(loanToken.address)

    assert(tx.events['Trade']['borrowedAmount'] == 2 * loan_token_sent)
    print('positionSize', tx.events['Trade']['positionSize'])
    print('token balance', sovryn_after_collateral_token_balance)
    assert(tx.events['Trade']['positionSize'] == sovryn_after_collateral_token_balance)
    assert(loan_token_sent*3 - tx.events['Trade']['borrowedAmount'] == loantoken_after_underlying_token_balance)
    
    # compute the expected values of the loan object
    start_margin = 1e38 / leverage_amount
    total_deposit = loan_token_sent + collateral_sent
    (trade_rate, trade_rate_precision) = priceFeeds.queryRate(underlyingToken.address, collateralToken.address)
    (collateral_to_loan_rate, collateral_to_loan_precision) = priceFeeds.queryRate(collateralToken.address, underlyingToken.address)
    collateral_to_loan_swap_rate = "%e"%(collateral_to_loan_precision *  trade_rate_precision / tx.events['Trade']['entryPrice'])
    interest_rate = loanToken.nextBorrowInterestRate(total_deposit * 1e20 / start_margin)
    principal = loan_token_sent * 2
    seconds_per_day = 24 * 60 * 60
    max_loan_duration = 28 * seconds_per_day
    seconds_per_year = 365 * seconds_per_day
    borrow_amount = total_deposit / (interest_rate / seconds_per_year * max_loan_duration / start_margin * 1e20 + 1e20) \
                    / start_margin * 1e40
    owed_per_day = borrow_amount * interest_rate / 365e20
    interest_amount_required = 28 * owed_per_day / seconds_per_day
    trading_fee = (loan_token_sent + borrow_amount) / 1e20 * 15e16  # 0.15% fee
    collateral = (collateral_sent + loan_token_sent + borrow_amount - interest_amount_required - trading_fee) \
                 * trade_rate / trade_rate_precision
    #current_margin = (collateral * collateral_to_loan_rate / 1e18 - principal) / principal * 1e20
    current_margin = fixedint(collateral).mul(collateral_to_loan_rate).div(1e18).sub(principal).mul(1e20).div(principal)
    #TODO: problem: rounding error somewhere
    
    loan_id = tx.events['Trade']['loanId']
    loan = sovryn.getLoan(loan_id).dict()
    end_timestamp = loan['endTimestamp']
    block_timestamp = chain.time().real
    interest_deposit_remaining = (end_timestamp - block_timestamp) * owed_per_day / seconds_per_day if (end_timestamp >= block_timestamp) else 0
    # assert the loan object is set as expected
    assert(loan['loanToken'] == underlyingToken.address)
    assert(loan['collateralToken'] == collateralToken.address)
    assert(loan['principal'] == principal)
    # LoanOpening::_borrowOrTrade::300
    print("==============================================")
    print(loan['collateral'])
    print(collateral)
    assert(loan['collateral'] == collateral)
    # LoanOpening::_initializeInterest:574
    assert(loan['interestOwedPerDay'] == owed_per_day)
    # LoanOpening::_getLoan:567
    assert(loan['interestDepositRemaining'] == interest_deposit_remaining)
    assert("%e"%loan['startRate'] == collateral_to_loan_swap_rate)
    assert(loan['startMargin'] == start_margin)
    assert(loan['maintenanceMargin'] == 15e18)
    # LoanMaintenance::_getLoan::539
    print('actual current margin', loan['currentMargin'])
    print('expected current margin', current_margin)
    #TODO fix the rounding error and activate the check
    #assert(loan['currentMargin'] == current_margin)
    assert(loan['maxLoanTerm'] == max_loan_duration)  # In the SC is hardcoded to 28 days
    assert((block_timestamp + max_loan_duration) - end_timestamp <= 1)
    # LoanMaintenance::_getLoan::549
    assert(loan['maxLiquidatable'] == 0)
    # LoanMaintenance::_getLoan::549
    assert(loan['maxSeizable'] == 0)

def margin_trading_sending_loan_tokens_tiny_amount(accounts, sovryn, loanToken, underlyingToken, collateralToken, priceFeeds, chain, sendValue):
    # preparation
    constants = shared.Constants()
    loan_token_sent = constants.TINY_AMOUNT
    underlyingToken.mint(loanToken.address, loan_token_sent*3)
    underlyingToken.mint(accounts[0], loan_token_sent)
    underlyingToken.approve(loanToken.address, loan_token_sent)
    value = loan_token_sent if sendValue else 0

    # send the transaction
    leverage_amount = 2e18
    collateral_sent = 0
    with reverts("total deposit too small"):
        loanToken.marginTrade(
            "0", #loanId  (0 for new loans)
            leverage_amount, # leverageAmount
            loan_token_sent, #loanTokenSent
            collateral_sent, # no collateral token sent
            collateralToken.address, #collateralTokenAddress
            accounts[0], #trader,
            b'', #loanDataBytes (only required with ether)
            {'value': value}
        )

def margin_trading_sov_reward_payment(accounts, loanToken, loan_token_sent, underlyingToken, collateralToken, chain, SOV, FeesEvents):
    # preparation
    underlyingToken.mint(loanToken.address, loan_token_sent*3)
    trader = accounts[0]
    underlyingToken.mint(trader, loan_token_sent)
    underlyingToken.approve(loanToken.address, loan_token_sent)
    value = 0

    # send the transaction
    leverage_amount = 2e18
    collateral_sent = 0
    sov_initial_balance = SOV.balanceOf(trader)
    tx = loanToken.marginTrade(
        "0", #loanId  (0 for new loans)
        leverage_amount, # leverageAmount
        loan_token_sent, #loanTokenSent
        collateral_sent, # no collateral token sent
        collateralToken.address, #collateralTokenAddress
        trader, #trader,
        b'', #loanDataBytes (only required with ether)
        {'value': value}
    )

    tx.info()

    chain.sleep(10*24*60*60)
    chain.mine(1)

    constants = shared.Constants()
    loan_id = constants.ZERO_32  # is zero because is a new loan
    verify_sov_reward_payment(tx, FeesEvents, SOV, trader, loan_id, sov_initial_balance, 1)


'''
makes a margin trade sending collateral tokens as collateral. therefore, only the loan needs to be swapped.
process:
1. send the margin trade tx with the passed parameter (NOTE: the token transfer needs to be approved already)
2. TODO verify the trade event and balances are correct
'''    
def margin_trading_sending_collateral_tokens(accounts, sovryn, loanToken, underlyingToken, collateralToken, loanSize, collateralTokenSent, leverageAmount, value, priceFeeds):
    
    get_estimated_margin_details(loanToken, collateralToken, loanSize, collateralTokenSent, leverageAmount)
    (rate, precision) = priceFeeds.queryRate(underlyingToken.address, collateralToken.address)

    tx = loanToken.marginTrade(
        "0", #loanId  (0 for new loans)
        leverageAmount, # leverageAmount
        0, #loanTokenSent
        collateralTokenSent, 
        collateralToken.address, #collateralTokenAddress
        accounts[0], #trader, 
        b'', #loanDataBytes (only required with ether),
        {'value' : value}
    )

    event = tx.events["Trade"]
    assert(event["positionSize"] == event["borrowedAmount"] * event["entryPrice"] / 1e18 + collateralTokenSent)
    assert(event["borrowedAmount"] == loanSize * collateralTokenSent * leverageAmount / 1e36)
    assert(event["interestRate"] == 0)
    assert(event["entryPrice"] == rate * (1-0.15/100))
    assert(event["entryLeverage"] == leverageAmount)


def margin_trading_sending_collateral_tokens_sov_reward_payment(trader, loanToken, collateralToken, collateralTokenSent,
                                                                leverageAmount, value, chain, FeesEvents, SOV):
    
    sov_initial_balance = SOV.balanceOf(trader)
    tx = loanToken.marginTrade(
        "0",  # loanId  (0 for new loans)
        leverageAmount,  # leverageAmount
        0,  # loanTokenSent
        collateralTokenSent,
        collateralToken.address,  # collateralTokenAddress
        trader,  # trader,
        b'',  # loanDataBytes (only required with ether),
        {'from': trader, 'value': value}
    )

    tx.info()

    chain.sleep(10*24*60*60)
    chain.mine(1)

    constants = shared.Constants()
    loan_id = constants.ZERO_32  # is zero because is a new loan
    verify_sov_reward_payment(tx, FeesEvents, SOV, trader, loan_id, sov_initial_balance, 1)


'''
close a position completely.
1. prepares the test by setting up the interest rates, lending to the pool and opening a position
2. travels in time, so interest needs to be paid
3. makes sure closing with an unauthorized caller fails (only the trader may close his position)
4. sends the closing tx from the trader
5. verifies the result
'''
def close_complete_margin_trade(sovryn, loanToken, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral):
    #prepare the test
    set_demand_curve()
    (receiver, _) = lend_to_pool()
    (loan_id, trader, loan_token_sent, leverage_amount) = open_margin_trade_position()

    chain.sleep(10*24*60*60)  # time travel 10 days
    chain.mine(1)
    initial_loan = sovryn.getLoan(loan_id)
    
    #needs to be called by the trader
    with reverts("unauthorized"):
        sovryn.closeWithSwap(loan_id, trader, loan_token_sent, return_token_is_collateral, "")
    
    #complete closure means the whole collateral is swapped
    swap_amount = initial_loan['collateral']

    internal_test_close_margin_trade(swap_amount, initial_loan, loanToken, loan_id, priceFeeds, sovryn, trader, web3, return_token_is_collateral)


def close_complete_margin_trade_sov_reward_payment(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position,
                                                   chain, return_token_is_collateral, FeesEvents, SOV):
    #prepare the test
    set_demand_curve()
    (receiver, _) = lend_to_pool()
    (loan_id, trader, loan_token_sent, leverage_amount) = open_margin_trade_position()

    chain.sleep(10*24*60*60)  # time travel 10 days
    chain.mine(1)
    initial_loan = sovryn.getLoan(loan_id)

    #needs to be called by the trader
    with reverts("unauthorized"):
        sovryn.closeWithSwap(loan_id, trader, loan_token_sent, return_token_is_collateral, "")

    #complete closure means the whole collateral is swapped
    swap_amount = initial_loan['collateral']

    sov_initial_balance = SOV.balanceOf(trader)
    tx = sovryn.closeWithSwap(loan_id, trader, swap_amount, return_token_is_collateral, "", {'from': trader})
    verify_sov_reward_payment(tx, FeesEvents, SOV, trader, loan_id, sov_initial_balance, 2)


'''
close a position partially
1. prepares the test by setting up the interest rates, lending to the pool and opening a position
2. travels in time, so interest needs to be paid
3. makes sure closing with an unauthorized caller fails (only the trader may close his position)
4. sends the closing tx from the trader
5. verifies the result
'''
def close_partial_margin_trade(sovryn, loanToken, web3, set_demand_curve, lend_to_pool, open_margin_trade_position, priceFeeds, chain, return_token_is_collateral):
    #prepare the test
    set_demand_curve()
    (receiver, _) = lend_to_pool()
    (loan_id, trader, loan_token_sent, leverage_amount) = open_margin_trade_position()

    chain.sleep(10*24*60*60)  # time travel 10 days
    chain.mine(1)
    initial_loan = sovryn.getLoan(loan_id)
    
    #needs to be called by the trader
    with reverts("unauthorized"):
        sovryn.closeWithSwap(loan_id, trader, loan_token_sent, return_token_is_collateral, "")

    swap_amount = fixedint(initial_loan['collateral']).mul(80*10**18).div(10**20).num

    internal_test_close_margin_trade(swap_amount, initial_loan, loanToken, loan_id, priceFeeds, sovryn, trader, web3, return_token_is_collateral)
    

def close_partial_margin_trade_sov_reward_payment(sovryn, set_demand_curve, lend_to_pool, open_margin_trade_position,
                                                  chain, return_token_is_collateral, FeesEvents, SOV):
    #prepare the test
    set_demand_curve()
    (receiver, _) = lend_to_pool()
    (loan_id, trader, loan_token_sent, leverage_amount) = open_margin_trade_position()

    chain.sleep(10*24*60*60)  # time travel 10 days
    chain.mine(1)
    initial_loan = sovryn.getLoan(loan_id)

    swap_amount = fixedint(initial_loan['collateral']).mul(80*10**18).div(10**20).num

    sov_initial_balance = SOV.balanceOf(trader)
    tx = sovryn.closeWithSwap(loan_id, trader, swap_amount, return_token_is_collateral, "", {'from': trader})
    verify_sov_reward_payment(tx, FeesEvents, SOV, trader, loan_id, sov_initial_balance, 2)


def internal_test_close_margin_trade(swap_amount, initial_loan, loanToken, loan_id, priceFeeds, sovryn, trader, web3, return_token_is_collateral):
    principal_ = initial_loan['principal']
    collateral_ = initial_loan['collateral']

    tx_loan_closing = sovryn.closeWithSwap(loan_id, trader, swap_amount, return_token_is_collateral, "", {'from': trader})
    print(tx_loan_closing)
    closed_loan = sovryn.getLoan(loan_id).dict()
    loan_token_ = initial_loan['loanToken']
    collateral_token_ = initial_loan['collateralToken']
    (trade_rate, precision) = priceFeeds.queryRate(collateral_token_, loan_token_)

    swap_amount = collateral_ if swap_amount > collateral_ else swap_amount

    loan_close_amount = \
        principal_ if swap_amount == collateral_ \
        else fixedint(principal_).mul(swap_amount).div(collateral_) if return_token_is_collateral \
        else 0

    interest_refund_to_borrower = fixedint(initial_loan['interestDepositRemaining']) \
        .mul(loan_close_amount).div(principal_)

    loan_close_amount_less_interest = fixedint(loan_close_amount).sub(interest_refund_to_borrower) \
        if loan_close_amount != 0 and fixedint(loan_close_amount).num >= interest_refund_to_borrower.num \
        else interest_refund_to_borrower

    trading_fee_percent = sovryn.tradingFeePercent()
    aux_trading_fee = loan_close_amount_less_interest if return_token_is_collateral else swap_amount
    trading_fee = fixedint(aux_trading_fee).mul(trading_fee_percent).div(1e20)

    source_token_amount_used = \
        fixedint(swap_amount) if not return_token_is_collateral \
        else fixedint(loan_close_amount_less_interest).add(trading_fee).mul(precision).div(trade_rate)

    dest_token_amount_received = \
        fixedint(swap_amount).sub(trading_fee).mul(trade_rate).div(precision) if not return_token_is_collateral \
        else loan_close_amount_less_interest

    collateral_to_loan_swap_rate = fixedint(dest_token_amount_received).mul(precision).div(source_token_amount_used)
    # 1e36 produces a wrong number because of floating point
    collateral_to_loan_swap_rate = fixedint(10**36).div(collateral_to_loan_swap_rate)

    source_token_amount_used_2 = collateral_ if dest_token_amount_received >= principal_ else source_token_amount_used.num
    used_collateral = source_token_amount_used_2 if source_token_amount_used_2 > swap_amount else swap_amount

    covered_principal = \
        loan_close_amount_less_interest if swap_amount == collateral_ or return_token_is_collateral\
        else principal_ if dest_token_amount_received >= principal_ \
        else dest_token_amount_received

    loan_close_amount = covered_principal if loan_close_amount == 0 else loan_close_amount

    new_collateral = fixedint(collateral_).sub(used_collateral) if used_collateral != 0 else collateral_
    new_principal = 0 if loan_close_amount == principal_ else fixedint(principal_).sub(loan_close_amount).num

    if return_token_is_collateral and collateral_ > swap_amount:
        print(new_principal)
        print(int(new_principal))

    current_margin = fixedint(new_collateral).mul(trade_rate).mul(1e18).div(precision).div(1e18)
    current_margin = current_margin.sub(new_principal).mul(1e20).div(new_principal) \
        if (new_principal != 0 and current_margin.num >= new_principal) else 0
    current_margin = fixedint(10**38).div(current_margin) if current_margin != 0 else 0

    loan_swap_event = tx_loan_closing.events['LoanSwap']
    assert (loan_swap_event['loanId'] == loan_id)
    assert (loan_swap_event['sourceToken'] == collateral_token_)
    assert (loan_swap_event['destToken'] == loan_token_)
    assert (loan_swap_event['borrower'] == trader)
    print('source token amount used', loan_swap_event['sourceAmount'] )
    print('source token amount expected', source_token_amount_used)
    print('difference',loan_swap_event['sourceAmount'] - source_token_amount_used)
    #10000 is the source buffer used by the sovryn swap connector
    assert (loan_swap_event['sourceAmount'] - source_token_amount_used <= 10000)
    assert (loan_swap_event['destAmount']>=fixedint(dest_token_amount_received).mul(995).div(1000).num)

    tx_loan_closing.info()
    close_with_swap_event = tx_loan_closing.events['CloseWithSwap']
    assert (close_with_swap_event['loanId'] == loan_id)
    assert (close_with_swap_event['loanCloseAmount'] == loan_close_amount)
    assert (close_with_swap_event['currentLeverage'] == current_margin)
    assert (close_with_swap_event['closer'] == trader)
    assert (close_with_swap_event['user'] == trader)
    assert (close_with_swap_event['lender'] == loanToken.address)
    assert (close_with_swap_event['collateralToken'] == collateral_token_)
    assert (close_with_swap_event['loanToken'] == loan_token_)
    assert (close_with_swap_event['positionCloseSize'] == used_collateral)
    print('exit price', close_with_swap_event['exitPrice'])
    print('expected rate', collateral_to_loan_swap_rate)
    print(fixedint(close_with_swap_event['exitPrice']).sub(collateral_to_loan_swap_rate).mul(100).div(collateral_to_loan_swap_rate) )
    assert (fixedint(close_with_swap_event['exitPrice']).sub(collateral_to_loan_swap_rate).mul(100).div(collateral_to_loan_swap_rate) == 0)

    assert (closed_loan['principal'] == new_principal)
    if loan_close_amount == principal_:
        last_block_timestamp = web3.eth.getBlock(web3.eth.blockNumber)['timestamp']
        assert (closed_loan['endTimestamp'] <= last_block_timestamp)

 
def get_estimated_margin_details(loanToken, collateralToken, loanSize, collateralTokenSent, leverageAmount):
            
    result = loanToken.getEstimatedMarginDetails.call(leverageAmount, 0, collateralTokenSent, collateralToken.address)
    
    assert(result[0] == loanSize * collateralTokenSent * leverageAmount / 1e36)
    assert(result[2] == 0)

    print("principal", result[0])
    print("collateral", result[1])
    print("interestRate", result[2])
    print("loanSize",loanSize)
    print("collateralTokenSent",collateralTokenSent)
    print("leverageAmount", leverageAmount)
    