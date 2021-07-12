from brownie import *
from brownie.network.contract import InterfaceContainer

import json
import csv

def main():
    global contracts, acct
    thisNetwork = network.show_active()

    # == Load config =======================================================================================================================
    if thisNetwork == "development":
        acct = accounts[0]
        configFile =  open('./scripts/contractInteraction/testnet_contracts.json')
    elif thisNetwork == "testnet":
        acct = accounts.load("rskdeployer")
        configFile =  open('./scripts/contractInteraction/testnet_contracts.json')
    elif thisNetwork == "rsk-testnet":
        acct = accounts.load("rskdeployer")
        configFile =  open('./scripts/contractInteraction/testnet_contracts.json')
    elif thisNetwork == "rsk-mainnet":
        acct = accounts.load("rskdeployer")
        configFile =  open('./scripts/contractInteraction/mainnet_contracts.json')
    else:
        raise Exception("network not supported")

    # load deployed contracts addresses
    contracts = json.load(configFile)
    
    vestingRegistryLogic = Contract.from_abi(
        "VestingRegistryLogic",
        address=contracts['VestingRegistryProxy'],
        abi=VestingRegistryLogic.abi,
        owner=acct)

    # open the file in universal line ending mode 
    with open('./scripts/deployment/distribution/vestingmigrationstest.csv', 'rU') as infile:
        #read the file as a dictionary for each row ({header : value})
        reader = csv.DictReader(infile)
        data = {}
        for row in reader:
            for header, value in row.items():
                try:
                    data[header].append(value)
                except KeyError:
                    data[header] = [value]

    # extract the variables you want
    tokenOwners = data['tokenOwner']
    vestingCreationTypes = data['vestingCreationType']
    print(tokenOwners)
    print(vestingCreationTypes)

    data = vestingRegistryLogic.addDeployedVestings.encode_input(tokenOwners, vestingCreationTypes)
    print(data)

    multisig = Contract.from_abi("MultiSig", address=contracts['multisig'], abi=MultiSigWallet.abi, owner=acct)
    print(multisig)
    tx = multisig.submitTransaction(vestingRegistryLogic.address, 0, data, {'allow_revert':True})
    print(tx.revert_msg)
    txId = tx.events["Submission"]["transactionId"]
    print(txId)