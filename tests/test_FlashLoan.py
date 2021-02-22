#!/usr/bin/python3
import pytest
import brownie
from brownie import network, Contract, Wei, reverts
from brownie.network.contract import InterfaceContainer

def loadContractFromEtherscan(address, alias):
    try:
        return Contract(alias)
    except ValueError:
        contract = Contract.from_explorer(address)
        contract.set_alias(alias)
        return contract

@pytest.fixture(scope="module")
def requireMainnetFork():
    assert network.show_active() == "mainnet-fork"
    
@pytest.fixture(scope="module")
def flashLoaner(accounts, FlashLoanerTest):
    proxy = accounts[0].deploy(FlashLoanerTest)
    return Contract.from_abi("flashLoaner", proxy.address, FlashLoanerTest.abi, accounts[0]);

@pytest.fixture(scope="module")
def WETH():
    return loadContractFromEtherscan("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "WETH")

@pytest.fixture(scope="module")
def iETH():
    return loadContractFromEtherscan("0xB983E01458529665007fF7E0CDdeCDB74B967Eb6", "iETH")

def testLoaner(accounts, requireMainnetFork, flashLoaner, WETH, iETH):
    print("flashLoaner.address", flashLoaner.address)

    amount = Wei('500 ether')

    tx = flashLoaner.doStuffWithFlashLoan(WETH.address, iETH.address, amount)
    
    balances = tx.events["BalanceOf"]
    assert(balances[0]["balance"] == 0)
    assert(balances[1]["balance"] == amount)
    assert(balances[2]["balance"] == 0)

    executeOperation = tx.events['ExecuteOperation']
    assert(executeOperation[0]["loanToken"] == WETH.address)
    assert(executeOperation[0]["iToken"] == iETH.address)
    assert(executeOperation[0]["loanAmount"] == amount)