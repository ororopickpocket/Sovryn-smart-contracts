import pytest
from brownie import Contract, Wei, network
from brownie.network.contract import InterfaceContainer
from brownie.network.state import _add_contract, _remove_contract
import shared

# returns a loan token with underlying token SUSD  
@pytest.fixture(scope="module", autouse=True)
def loanToken(LoanToken, LoanTokenLogicTest, LoanTokenSettingsLowerAdmin, SUSD, WRBTC, accounts, sovryn, Constants, priceFeeds, swapsImpl):

    loanTokenLogic = accounts[0].deploy(LoanTokenLogicTest)
    #Deploying loan token using the loan logic as target for delegate calls
    loanToken = accounts[0].deploy(LoanToken, accounts[0], loanTokenLogic.address, sovryn.address, WRBTC.address)
    #Initialize loanTokenAddress
    loanToken.initialize(SUSD, "SUSD", "SUSD")
    #setting the logic ABI for the loan token contract
    loanToken = Contract.from_abi("loanToken", address=loanToken.address, abi=LoanTokenLogicTest.abi, owner=accounts[0])

    # loan token Price should be equals to initial price
    assert loanToken.tokenPrice() == loanToken.initialPrice()
    initial_total_supply = loanToken.totalSupply()
    # loan token total supply should be zero
    assert initial_total_supply == loanToken.totalSupply()

    return loanToken
    
@pytest.fixture(scope="module", autouse=True)
def loanTokenWRBTC(LoanToken, LoanTokenLogicWrbtc, LoanTokenSettingsLowerAdmin, SUSD, WRBTC, accounts, sovryn, Constants, priceFeeds, swapsImpl):

    loanTokenLogic = accounts[0].deploy(LoanTokenLogicWrbtc)
    # Deploying loan token using the loan logic as target for delegate calls
    loanToken = accounts[0].deploy(LoanToken, accounts[0], loanTokenLogic.address, sovryn.address, WRBTC.address)
    # Initialize loanTokenAddress
    loanToken.initialize(WRBTC, "iWRBTC", "iWRBTC")
    # setting the logic ABI for the loan token contract
    loanToken = Contract.from_abi("loanToken", address=loanToken.address, abi=LoanTokenLogicWrbtc.abi, owner=accounts[0])

    # loan token Price should be equals to initial price
    assert loanToken.tokenPrice() == loanToken.initialPrice()
    initial_total_supply = loanToken.totalSupply()
    # loan token total supply should be zero
    assert initial_total_supply == loanToken.totalSupply()

    return loanToken
    
@pytest.fixture(scope="module", autouse=True)   
def loanTokenLogic(accounts, LoanTokenLogicStandard):
    loanTokenLogic = accounts[0].deploy(LoanTokenLogicStandard)
    return loanTokenLogic

@pytest.fixture(scope="module", autouse=True)   
def loanTokenSettings(accounts, LoanTokenSettingsLowerAdmin):
    loanTokenSettings = accounts[0].deploy(LoanTokenSettingsLowerAdmin)
    return loanTokenSettings
    
@pytest.fixture(scope="module", autouse=True)
def loanOpenings(LoanOpenings, accounts, sovryn, Constants, priceFeeds, swapsImpl):
    sovryn.replaceContract(accounts[0].deploy(LoanOpenings).address)
    sovryn.setPriceFeedContract(priceFeeds.address)
    sovryn.setSwapsImplContract(swapsImpl.address )
    
@pytest.fixture(scope="module", autouse=True)
def loanClosingsBase(LoanClosingsBase, accounts, sovryn, Constants, priceFeeds, swapsImpl):
    sovryn.replaceContract(accounts[0].deploy(LoanClosingsBase))

@pytest.fixture(scope="module", autouse=True)
def loanClosingsWith(LoanClosingsWith, accounts, sovryn, Constants, priceFeeds, swapsImpl):
    sovryn.replaceContract(accounts[0].deploy(LoanClosingsWith))

@pytest.fixture(scope="module", autouse=True)
def affiliates(Affiliates, accounts, sovryn, Constants, priceFeeds, swapsImpl):
    sovryn.replaceContract(accounts[0].deploy(Affiliates).address)

'''
set up the margin and torque pool parameter for the iSUSD and iBTC loanToken contract
1. using RBTC (TestToken) as collateral
2. using wRBTC as collateral
set up the loan pool at the protocol contract
'''
@pytest.fixture(scope="module", autouse=True)
def loan_pool_setup(accounts, RBTC, WRBTC, loanTokenSettings, loanToken, loanTokenWRBTC, sovryn, SUSD):
    #preparing the parameter
    constants = shared.Constants()
    params = [];
    setup1 = [
        b"0x0", ## id
        False, ## active
        str(accounts[0]), ## owner
        constants.ZERO_ADDRESS, ## loanToken -> will be overwritten
        RBTC.address, ## collateralToken. 
        Wei("20 ether"), ## minInitialMargin
        Wei("15 ether"), ## maintenanceMargin
        0 ## fixedLoanTerm -> will be overwritten
    ]
    print(setup1)
    params.append(setup1)
    setup2 = setup1.copy()
    setup2[4] = WRBTC.address
    print(setup2)
    params.append(setup2)
    
    # setting up the margin pool
    tx = loanToken.setupLoanParams(params, False)
    assert('LoanParamsSetup' in tx.events)
    assert('LoanParamsIdSetup' in tx.events)
    tx = loanToken.setupLoanParams(params, True)
    assert('LoanParamsSetup' in tx.events)
    assert('LoanParamsIdSetup' in tx.events)
    
    # setting up the torque pool
    params = [];
    setup3 = setup1.copy()
    setup3[4] = SUSD.address
    params.append(setup3)
    tx = loanTokenWRBTC.setupLoanParams(params, False)
    assert('LoanParamsSetup' in tx.events)
    assert('LoanParamsIdSetup' in tx.events)
    tx = loanTokenWRBTC.setupLoanParams(params, True)
    assert('LoanParamsSetup' in tx.events)
    assert('LoanParamsIdSetup' in tx.events)
    
    #setting the loan pools
    sovryn.setLoanPool(
        [loanToken.address, loanTokenWRBTC.address],
        [SUSD.address, WRBTC.address] 
    )
    


@pytest.fixture
def set_demand_curve(loanToken, LoanToken, LoanTokenLogicStandard, LoanTokenSettingsLowerAdmin, accounts, loanTokenSettings):
    def internal_set_demand_curve(baseRate=1e18, rateMultiplier=20.25e18, targetLevel=80*10**18, kinkLevel=90*10**18,
                                  maxScaleRate=100*10**18, loan_token_address=loanToken.address):
        localLoanToken = Contract.from_abi("loanToken", address=loanToken.address, abi=LoanTokenLogicStandard.abi, owner=accounts[0])
 
        localLoanToken.setDemandCurve(baseRate, rateMultiplier, baseRate, rateMultiplier, targetLevel, kinkLevel, maxScaleRate)
        borrow_interest_rate = loanToken.borrowInterestRate()
        print("borrowInterestRate: ", borrow_interest_rate)
        assert (borrow_interest_rate > baseRate)

    return internal_set_demand_curve


@pytest.fixture
def lend_to_pool(accounts, SUSD, loanToken):
    def internal_lend(lender=accounts[0], lend_amount=1e30):
        # lend
        SUSD.mint(lender, lend_amount)
        SUSD.approve(loanToken.address, lend_amount)
        loanToken.mint(lender, lend_amount)

        return lender, lend_amount

    return internal_lend
    
@pytest.fixture
def lend_to_pool_iBTC(accounts, SUSD, loanTokenWRBTC):
    def internal_lend(lender=accounts[0], lend_amount=1e21):
        # lend
        loanTokenWRBTC.mintWithBTC(lender, {'from':lender, 'value':lend_amount})

        return lender, lend_amount

    return internal_lend


@pytest.fixture
def open_margin_trade_position(accounts, SUSD, RBTC, WRBTC, loanToken):
    def internal_open_margin_trade(collateral = 'RBTC',
                                    trader=accounts[1],
                                   loan_token_sent=100e18,
                                   leverage_amount=2e18):
        """
        Opens a margin trade position
        :param trader: trader address
        :param loan_token_sent: loan token amount sent
        :param leverage_amount: leverage amount in form 1x,2x,3x,4x,5x where 1 is 1e18
        :return: loan_id, trader, loan_token_sent and leverage_amount
        """
        SUSD.mint(trader, loan_token_sent)
        SUSD.approve(loanToken.address, loan_token_sent, {'from': trader})
        
        if(collateral == 'RBTC'): 
            collateralToken = RBTC.address
        else:
            collateralToken = WRBTC.address

        tx = loanToken.marginTrade(
            "0",  # loanId  (0 for new loans)
            leverage_amount,  # leverageAmount
            loan_token_sent,  # loanTokenSent
            0,  # no collateral token sent
            RBTC.address,  # collateralTokenAddress
            trader,  # trader,
            0,  # minReturn
            b'',  # loanDataBytes (only required with ether)
            {'from': trader}
        )

        return tx.events['Trade']['loanId'], trader, loan_token_sent, leverage_amount

    return internal_open_margin_trade

def open_margin_trade_position_with_affiliate(accounts, SUSD, RBTC, WRBTC, loanToken):
    def internal_open_margin_trade_affiliate(collateral = 'RBTC',
                                   trader=accounts[1],
                                   referrer = accounts[2],
                                   loan_token_sent=100e18,
                                   leverage_amount=2e18):
        """
        Opens a margin trade position with affiliate address passed
        :param trader: trader address
        :param referrer: affiliate referrer address
        :param loan_token_sent: loan token amount sent
        :param leverage_amount: leverage amount in form 1x,2x,3x,4x,5x where 1 is 1e18
        :return: loan_id, trader, loan_token_sent and leverage_amount
        """
        SUSD.mint(trader, loan_token_sent)
        SUSD.approve(loanToken.address, loan_token_sent, {'from': trader})
        
        if(collateral == 'RBTC'): 
            collateralToken = RBTC.address
        else:
            collateralToken = WRBTC.address

        tx = loanToken.marginTradeAffiliate(
            "0",  # loanId  (0 for new loans)
            leverage_amount,  # leverageAmount
            loan_token_sent,  # loanTokenSent
            0,  # no collateral token sent
            RBTC.address,  # collateralTokenAddress
            trader,  # trader,
            0, # max slippage
            referrer, # affiliates referrer
            b'',  # loanDataBytes (only required with ether)
            {'from': trader}
        )
#STOPPEDHERE 
        # emit SetAffiliatesReferrer(user, referrer);
        eventReferrer = tx.events['SetAffiliatesReferrer']
        print(eventReferrer)

        # emit PayTradingFeeToAffiliate(referrer, token, referrerTradingFee);
        eventPayReferrer = tx.events['PayTradingFeeToAffiliate']
        print(eventPayReferrer)
        return eventReferrer, eventPayReferrer, trader, referrer, loan_token_sent, leverage_amount

    return internal_open_margin_trade_affiliate
    
@pytest.fixture
def open_margin_trade_position_iBTC(accounts, SUSD, RBTC, loanTokenWRBTC):
    def internal_open_margin_trade(trader=accounts[1],
                                   loan_token_sent=1e18,
                                   leverage_amount=2e18):
        """
        Opens a margin trade position on the loanTokenWRBTC contract
        :param trader: trader address
        :param loan_token_sent: loan token amount sent
        :param leverage_amount: leverage amount in form 1x,2x,3x,4x,5x where 1 is 1e18
        :return: loan_id, trader, loan_token_sent and leverage_amount
        """

        tx = loanTokenWRBTC.marginTrade(
            "0",  # loanId  (0 for new loans)
            leverage_amount,  # leverageAmount
            loan_token_sent,  # loanTokenSent
            0,  # no collateral token sent
            SUSD.address,  # collateralTokenAddress
            trader,  # trader,
            0,  # minReturn
            b'',  # loanDataBytes (only required with ether)
            {'from': trader, 'value': loan_token_sent}
        )

        return tx.events['Trade']['loanId'], trader, loan_token_sent, leverage_amount

    return internal_open_margin_trade


@pytest.fixture
def borrow_indefinite_loan(RBTC, SUSD, accounts, loanToken, sovryn):
    def internal_borrow(withdraw_amount=10e18, margin=50e18, duration_in_seconds=60 * 60 * 24 * 10,
                        borrower=accounts[2], receiver=accounts[1]):
        collateral_token_sent = sovryn.getRequiredCollateral(SUSD.address, RBTC.address, withdraw_amount, margin, True)
        # approve the transfer of the collateral
        RBTC.mint(borrower, collateral_token_sent)
        RBTC.approve(loanToken.address, collateral_token_sent, {'from': borrower})
        # borrow some funds
        tx = loanToken.borrow(
            "0",  # bytes32 loanId
            withdraw_amount,  # uint256 withdrawAmount
            duration_in_seconds,  # uint256 initialLoanDuration
            collateral_token_sent,  # uint256 collateralTokenSent
            RBTC.address,  # address collateralTokenAddress
            borrower,  # address borrower
            receiver,  # address receiver
            b'',  # bytes memory loanDataBytes
            {'from': borrower}
        )
        loan_id = tx.events['Borrow']['loanId']
        return loan_id, borrower, receiver, withdraw_amount, duration_in_seconds, margin, tx

    return internal_borrow

@pytest.fixture(scope="module", autouse=True)   
def name():
    name = "TestName"
    return name

@pytest.fixture(scope="module", autouse=True)   
def symbol():
    symbol = "TestSymbol"
    return symbol