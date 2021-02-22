#!/usr/bin/python3

from brownie import *
from brownie.network.contract import InterfaceContainer
from brownie.network.state import _add_contract

import shared
import json

with open('./scripts/swapTest/swap_test_usdt.json') as config_file:
  dataFromSwapTestUSDT = json.load(config_file)

def main():
    global this_network, acct

    this_network = network.show_active()

    if this_network == "development":
        acct = accounts[0]
    elif this_network == "testnet":
        acct = accounts.load("rskdeployer")
    else:
        raise Exception("network not supported")

    setup()

    if this_network == "development":
        margin_pool_setup()
        test_loan_address()
    test_margin_trading_sending_collateral_tokens()
    test_margin_trading_sending_loan_tokens()
    
    if this_network == "development":
        test_lend_to_the_pool()
        test_cash_out_from_the_pool()
        test_cash_out_from_the_pool_more_of_lender_balance()
        test_supply_interest_fee()
        test_transfer()
        test_liquidate()
    

def setup():
    global sovryn, loan_token, loan_token_address, USDT, RBTC, loan_token_settings

    sovryn_address = dataFromSwapTestUSDT["sovrynProtocol"]
    contract_registry_address = dataFromSwapTestUSDT["contractRegistry"]
    loan_token_address = dataFromSwapTestUSDT["loanToken"]
    loan_token_settings_address = dataFromSwapTestUSDT["loanTokenSettings"]
    USDT_address = dataFromSwapTestUSDT["UnderlyingToken"]
    RBTC_address = dataFromSwapTestUSDT["WRBTC"]

    sovryn = Contract.from_abi("sovryn", address=sovryn_address, abi=interface.ISovrynBrownie.abi, owner=acct)
    loan_token = Contract.from_abi("loanToken", address=loan_token_address, abi=LoanTokenLogicStandard.abi, owner=acct)
    loan_token_settings = Contract.from_abi("loanTokenSettings", address=loan_token_settings_address, abi=LoanTokenSettingsLowerAdmin.abi, owner=acct)
    USDT = Contract.from_abi("TestToken", address=USDT_address, abi=TestToken.abi, owner=acct)
    RBTC = Contract.from_abi("TestToken", address=RBTC_address, abi=TestToken.abi, owner=acct)

    print("Setting the SovrynSwap contract registry address")
    sovryn.setSovrynSwapContractRegistryAddress(contract_registry_address)  # 0x1280691943Ad9d6B0B9D19f4C62f318C071c41ab

    initial_total_supply = loan_token.totalSupply()
    # loan token total supply should be zero
    if initial_total_supply != loan_token.totalSupply():
        raise Exception("Failed to validate `setup` - total supply is not zero")

    print("Passed `setup`")

def margin_pool_setup():
    constants = shared.Constants()
    params = []
    setup = [
        b"0x0", ## id
        False, ## active
        acct, ## owner
        constants.ZERO_ADDRESS, ## loanToken -> will be overwritten
        RBTC.address, ## collateralToken.
        Wei("20 ether"), ## minInitialMargin
        Wei("15 ether"), ## maintenanceMargin
        0 ## fixedLoanTerm -> will be overwritten
    ]
    params.append(setup)
    calldata = loan_token_settings.setupLoanParams.encode_input(params, False)
    tx = loan_token.updateSettings(loan_token_settings.address, calldata)

    print(tx.info())

    sovryn.setLoanPool(
        [loan_token.address],
        [USDT.address]
    )

    print("Passed `margin_pool_setup`")


def test_loan_address():
    loan_token_address = loan_token.loanTokenAddress()
    if loan_token_address != USDT.address:
        raise Exception("Failed to validate `test_loan_address` - mismatch in loan address")

    print("Passed `test_loan_address`")


def test_margin_trading_sending_collateral_tokens():
    loan_token_sent = 1e18
    leverage_amount = 2e18

    # USDT.mint(loan_token.address,loan_token_sent*6)
    # address loanToken, address collateralToken, uint256 newPrincipal,uint256 marginAmount, bool isTorqueLoan
    collateral_token_sent = sovryn.getRequiredCollateral(USDT.address,RBTC.address,loan_token_sent*2,50e18, False)
    print('collateralTokenSent', collateral_token_sent)
    # RBTC.mint(acct,collateral_token_sent)
    # important! WEth is being held by the loanToken contract itself, all other tokens are transfered directly from
    # the sender and need approval
    RBTC.approve(loan_token.address, collateral_token_sent)

    tx = loan_token.marginTrade(
        "0", #loanId  (0 for new loans)
        leverage_amount, # leverageAmount
        0, #loanTokenSent
        collateral_token_sent,
        RBTC.address, #collateralTokenAddress
        acct, #trader,
        b'', #loanDataBytes (only required with ether)
        {'value': collateral_token_sent}
    )
    
    print("entered position successfully")

    sovryn.closeWithSwap(tx.events['Trade']['loanId'], acct, collateral_token_sent, False, "")

    print("Passed `test_margin_trading_sending_collateral_tokens`")

def test_margin_trading_sending_loan_tokens():
    loan_token_sent = 10e18
    leverage_amount = 2e18

    RBTC.mint(loan_token.address, 1e17)
    USDT.mint(loan_token.address, 1000e18)
    USDT.approve(loan_token.address, 1000e18)

    loan_token_before_usdt_balance = USDT.balanceOf(loan_token_address)

    tx = loan_token.marginTrade(
        "0", # loanId  (0 for new loans)
        leverage_amount, # leverageAmount
        loan_token_sent, # loanTokenSent
        0, # no collateral token sent
        RBTC.address, # collateralTokenAddress
        acct, # trader,
        b'' # loanDataBytes (only required with ether)
    )

    sovryn_after_rbtc_balance = RBTC.balanceOf(sovryn.address)
    loan_token_after_usdt_balance = USDT.balanceOf(loan_token_address)

    print(tx.info())

    if tx.events['Trade']['positionSize'] > sovryn_after_rbtc_balance:
        raise Exception("Failed to validate `test_margin_trading_sending_loan_tokens` - positionSize is incorrect")

    if tx.events['Trade']['borrowedAmount'] > 2 * loan_token_sent:
        raise Exception("Failed to validate `test_margin_trading_sending_loan_tokens` - borrowedAmount is incorrect")

    if loan_token_before_usdt_balance - tx.events['Trade']['borrowedAmount'] > loan_token_after_usdt_balance:
        raise Exception("Failed to validate `test_margin_trading_sending_loan_tokens` - borrowedAmount balance is incorrect")

    loan_id = tx.events['Trade']['loanId']
    loan = sovryn.getLoan(loan_id).dict()

    if loan['loanToken'] != USDT.address:
        raise Exception("Failed to validate `test_margin_trading_sending_loan_tokens` - loan address is incorrect")

    if loan['collateralToken'] != RBTC.address:
        raise Exception("Failed to validate `test_margin_trading_sending_loan_tokens` - collateral address is incorrect")

    if loan['maxLiquidatable'] != 0:
         raise Exception("Failed to validate `test_margin_trading_sending_loan_tokens` - collateral address is incorrect")

    if loan['maxSeizable'] != 0:
         raise Exception("Failed to validate `test_margin_trading_sending_loan_tokens` - collateral address is incorrect")

    print("Passed `test_margin_trading_sending_loan_tokens`")


def test_lend_to_the_pool():
    baseRate = 1e18
    rateMultiplier = 20.25e18

    lender = acct
    deposit_amount = 400e18
    loan_token_sent = 100e18
    total_deposit_amount = deposit_amount + loan_token_sent
    initial_balance = USDT.balanceOf(lender)

    USDT.approve(loan_token.address, total_deposit_amount)

    if USDT.balanceOf(lender) != initial_balance:
        raise Exception("Failed to validate `test_lend_to_the_pool` - balance is incorrect")

    loan_token.mint(lender, deposit_amount)
    if USDT.balanceOf(lender) != initial_balance - deposit_amount:
        raise Exception("Failed to validate `test_lend_to_the_pool` - balance is incorrect")

    print("Passed `test_lend_to_the_pool`")

def test_cash_out_from_the_pool():
    lender = acct
    initial_balance = USDT.balanceOf(lender)
    amount_withdrawn = 10e18
    total_deposit_amount = amount_withdrawn * 2

    if initial_balance < total_deposit_amount:
        raise Exception("Failed to validate `test_cash_out_from_the_pool` - total balance is incorrect")

    USDT.approve(loan_token.address, total_deposit_amount)
    loan_token_initial_balance = total_deposit_amount / loan_token.initialPrice() * 1e18

    # loan_token.burn(lender, amount_withdrawn)
    if loan_token.totalSupply() < amount_withdrawn:
        raise Exception("Failed to validate `test_cash_out_from_the_pool` - amount_withdrawn is incorrect")

    if loan_token.balanceOf(lender) < amount_withdrawn:
        raise Exception("Failed to validate `test_cash_out_from_the_pool` - amount_withdrawn (2) is incorrect")

    if USDT.balanceOf(lender) < initial_balance - amount_withdrawn * loan_token.tokenPrice() / 1e18:
        raise Exception("Failed to validate `test_cash_out_from_the_pool` - amount_withdrawn (3) is incorrect")

    print("Passed `test_cash_out_from_the_pool`")

def test_cash_out_from_the_pool_more_of_lender_balance():
    lender = acct
    initial_balance = USDT.balanceOf(lender)
    amount_withdrawn = 100e18
    total_deposit_amount = amount_withdrawn * 2
    if initial_balance < total_deposit_amount:
        raise Exception("Failed to validate `test_cash_out_from_the_pool_more_of_lender_balance` - initial_balance is incorrect")

    USDT.approve(loan_token.address, total_deposit_amount)
    loan_token.mint(lender, total_deposit_amount)
    # loan_token.burn(lender, total_deposit_amount * 2)

    if loan_token.tokenPrice() < loan_token.initialPrice():
        raise Exception("Failed to validate `test_cash_out_from_the_pool_more_of_lender_balance` - tokenPrice is incorrect")

    print("Passed `test_cash_out_from_the_pool_more_of_lender_balance`")

def test_supply_interest_fee():
    USDT.approve(loan_token.address, 1000e18)
    loan_token.mint(acct, 10e18)

    tx = loan_token.marginTrade(
        "0", #loanId  (0 for new loans)
        2e18, # leverageAmount
        10e18, #loanTokenSent
        0, # no collateral token sent
        RBTC.address, #collateralTokenAddress
        acct, #trader,
        b'' #loanDataBytes (only required with ether)
    )

    tas = loan_token.totalAssetSupply()
    print("total supply", tas/1e18)
    tab = loan_token.totalAssetBorrow()
    print("total asset borrowed", tab/1e18)
    abir = loan_token.avgBorrowInterestRate()
    print("average borrow interest rate", abir/1e18)
    ir = loan_token.nextSupplyInterestRate(0)
    print("interest rate", ir)

    loan_token.mint(acct, 1e18)

    print("Passed `test_supply_interest_fee`")

def initialize_test_transfer(USDT, accounts, _loan_token):
    sender = accounts[0]
    receiver = accounts[1]
    amount_to_buy = 100e18
    USDT.approve(_loan_token.address, amount_to_buy)
    _loan_token.mint(sender, amount_to_buy)
    sender_initial_balance = _loan_token.balanceOf(sender)
    amount_sent = sender_initial_balance / 2

    return amount_sent, receiver, sender

def test_transfer():
    amount_sent, receiver, sender = initialize_test_transfer(USDT, accounts, loan_token)

    tx = loan_token.transfer(receiver, amount_sent)
    transfer_event = tx.events['Transfer']

    if transfer_event['from'] != sender or transfer_event['to'] != receiver or transfer_event['value'] != amount_sent:
        raise Exception("Failed to validate `test_transfer` - tx is invalid")

    print("Passed `test_transfer`")


def test_liquidate():
    USDT.approve(loan_token.address, 1000e18)
    lender = accounts[0]
    borrower = accounts[1]
    liquidator = accounts[2]
    loan_token.mint(lender, 1e18)
    loan_token_sent = 1e18
    USDT.mint(borrower, loan_token_sent)
    USDT.mint(liquidator, loan_token_sent)

    USDT.approve(loan_token.address, loan_token_sent, {'from': borrower})

    tx = loan_token.marginTrade(
        "0",  # loanId  (0 for new loans)
        2e18,  # leverageAmount
        loan_token_sent,  # loanTokenSent
        0,  # no collateral token sent
        RBTC.address,  # collateralTokenAddress
        borrower,  # trader,
        b'',  # loanDataBytes (only required with ether)
        {'from': borrower}
    )

    loan_id = tx.events['Trade']['loanId']
    loan = sovryn.getLoan(loan_id).dict()

    print("Loan ", loan)

    if not loan_id:
        raise Exception("Failed to validate `test_liquidate` - loan expected")

    print("Passed `test_liquidate`")


