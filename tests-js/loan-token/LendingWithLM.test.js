const { expect, assert } = require("chai");
const { expectRevert, expectEvent, BN } = require("@openzeppelin/test-helpers");
const { increaseTime, etherMantissa, mineBlock, advanceBlocks } = require("../Utils/Ethereum");

const TestToken = artifacts.require("TestToken");
const TestWrbtc = artifacts.require("TestWrbtc");

const sovrynProtocol = artifacts.require("sovrynProtocol");
const ProtocolSettings = artifacts.require("ProtocolSettings");
const ISovryn = artifacts.require("ISovryn");

const LoanToken = artifacts.require("LoanToken");
const LoanTokenLogicLM = artifacts.require("LoanTokenLogicLM");
const LoanTokenLogicWRBTC = artifacts.require("LoanTokenLogicWrbtc");
const LoanSettings = artifacts.require("LoanSettings");
const LoanMaintenance = artifacts.require("LoanMaintenance");
const LoanOpenings = artifacts.require("LoanOpenings");
const LoanClosingsBase = artifacts.require("LoanClosingsBase");
const LoanClosingsWith = artifacts.require("LoanClosingsWith");
const SwapsExternal = artifacts.require("SwapsExternal");

const PriceFeedsLocal = artifacts.require("PriceFeedsLocal");
const TestSovrynSwap = artifacts.require("TestSovrynSwap");
const SwapsImplLocal = artifacts.require("SwapsImplLocal");

const LiquidityMiningLogic = artifacts.require("LiquidityMiningMockup");
const LiquidityMiningProxy = artifacts.require("LiquidityMiningProxy");
const LockedSOV = artifacts.require("LockedSOV");

const TOTAL_SUPPLY = web3.utils.toWei("1000", "ether");

//const { lend_to_the_pool, cash_out_from_the_pool, cash_out_from_the_pool_more_of_lender_balance_should_not_fail } = require("./helpers");
const { lend_to_the_pool, cash_out_from_the_pool, cash_out_from_the_pool_uint256_max_should_withdraw_total_balance } = require("./helpers");

const wei = web3.utils.toWei;

contract("LoanTokenLogicLM", (accounts) => {
	const name = "Test token";
	const symbol = "TST";
	const depositAmount = new BN(wei("400", "ether"));

	let lender, account1, account2, account3, account4;
	let underlyingToken, testWrbtc;
	let sovryn, loanToken, loanTokenWRBTC;
	let liquidityMining;
	let lockedSOVAdmins, lockedSOV;

	before(async () => {
		[lender, account1, account2, account3, account4, ...accounts] = accounts;
		await deployProtocol();
		await deployLoanTokens();
		await deployLiquidityMining();

		await loanToken.setLiquidityMiningAddress(liquidityMining.address);
		await loanTokenWRBTC.setLiquidityMiningAddress(liquidityMining.address);
		await liquidityMining.add(loanToken.address, 10, false);
		await liquidityMining.add(loanTokenWRBTC.address, 10, true);
	});

	describe("Test lending with liquidity mining", () => {
		it("Should lend to the pool and deposit the pool tokens at the liquidity mining contract", async () => {
			//await lend_to_the_pool(loanToken, lender, underlyingToken, testWrbtc, sovryn);
			await underlyingToken.approve(loanToken.address, depositAmount);
			const tx = await loanToken.mint(lender, depositAmount, true);
			const userInfo = await liquidityMining.getUserInfo(loanToken.address, lender);
			//expected: user pool token balance is 0, but balance of LM contract increased
			expect(await loanToken.balanceOf(lender)).bignumber.equal("0");
			expect(userInfo.amount).bignumber.equal(depositAmount);
			expect(await loanToken.totalSupply()).bignumber.equal(depositAmount);
			//expect the Mint event to mention the lender
			expectEvent(tx, "Mint", {
				minter: lender,
				tokenAmount: depositAmount,
				assetAmount: depositAmount,
			});
		});

		it("Should lend to the pool without depositing the pool tokens at the liquidity mining contract", async () => {
			await underlyingToken.approve(loanToken.address, depositAmount);
			const tx = await loanToken.mint(lender, depositAmount, false);
			const userInfo = await liquidityMining.getUserInfo(loanToken.address, lender);
			//expected: user pool token balance increased by the deposited amount, LM balance stays unchanged
			expect(await loanToken.balanceOf(lender)).bignumber.equal(depositAmount);
			expect(userInfo.amount).bignumber.equal(depositAmount);
			expect(await loanToken.totalSupply()).bignumber.equal(depositAmount.mul(new BN("2")));
		});

		it("Should remove the pool tokens from the liquidity mining pool and burn them", async () => {
			let userInfo = await liquidityMining.getUserInfo(loanToken.address, lender);
			const tx = await loanToken.burn(lender, userInfo.amount, true);
			userInfo = await liquidityMining.getUserInfo(loanToken.address, lender);
			//expected: user pool token balance stayed the same but LM balance is 0
			expect(await loanToken.balanceOf(lender)).bignumber.equal(depositAmount);
			expect(userInfo.amount).bignumber.equal("0");
			expect(await loanToken.totalSupply()).bignumber.equal(depositAmount);
			//expect the Burn event to mention the lender
			expectEvent(tx, "Burn", {
				burner: lender,
				tokenAmount: depositAmount,
				assetAmount: depositAmount,
			});
		});

		it("Should burn pool tokens without removing them from the LM pool", async () => {
			await loanToken.burn(lender, depositAmount, false);
			expect(await loanToken.balanceOf(lender)).bignumber.equal("0");
			expect(await loanToken.totalSupply()).bignumber.equal("0");
		});
	});

	describe("Test WRBTC lending with liquidity mining", () => {
		it("Should lend to the pool and deposit the pool tokens at the liquidity mining contract", async () => {
			//await lend_to_the_pool(loanToken, lender, underlyingToken, testWrbtc, sovryn);
			const tx = await loanTokenWRBTC.mintWithBTC(lender, true, { value: depositAmount });
			const userInfo = await liquidityMining.getUserInfo(loanTokenWRBTC.address, lender);
			//expected: user pool token balance is 0, but balance of LM contract increased
			expect(await loanTokenWRBTC.balanceOf(lender)).bignumber.equal("0");
			expect(userInfo.amount).bignumber.equal(depositAmount);
			expect(await loanTokenWRBTC.totalSupply()).bignumber.equal(depositAmount);
			//expect the Mint event to mention the lender
			expectEvent(tx, "Mint", {
				minter: lender,
				tokenAmount: depositAmount,
				assetAmount: depositAmount,
			});
		});

		it("Should lend to the pool without depositing the pool tokens at the liquidity mining contract", async () => {
			await loanTokenWRBTC.mintWithBTC(lender, false, { value: depositAmount });
			const userInfo = await liquidityMining.getUserInfo(loanTokenWRBTC.address, lender);
			//expected: user pool token balance increased by the deposited amount, LM balance stays unchanged
			expect(await loanTokenWRBTC.balanceOf(lender)).bignumber.equal(depositAmount);
			expect(userInfo.amount).bignumber.equal(depositAmount);
			expect(await loanTokenWRBTC.totalSupply()).bignumber.equal(depositAmount.mul(new BN("2")));
		});

		it("Should remove the pool tokens from the liquidity mining pool and burn them", async () => {
			let userInfo = await liquidityMining.getUserInfo(loanTokenWRBTC.address, lender);
			const tx = await loanTokenWRBTC.burnToBTC(lender, userInfo.amount, true);
			userInfo = await liquidityMining.getUserInfo(loanTokenWRBTC.address, lender);
			//expected: user pool token balance stayed the same but LM balance is 0
			expect(await loanTokenWRBTC.balanceOf(lender)).bignumber.equal(depositAmount);
			expect(userInfo.amount).bignumber.equal("0");
			expect(await loanTokenWRBTC.totalSupply()).bignumber.equal(depositAmount);
			//expect the Burn event to mention the lender
			expectEvent(tx, "Burn", {
				burner: lender,
				tokenAmount: depositAmount,
				assetAmount: depositAmount,
			});
		});

		it("Should burn pool tokens without removing them from the LM pool", async () => {
			await loanTokenWRBTC.burnToBTC(lender, depositAmount, false);
			expect(await loanTokenWRBTC.balanceOf(lender)).bignumber.equal("0");
			expect(await loanTokenWRBTC.totalSupply()).bignumber.equal("0");
		});
	});

	describe("Test setting the liquidity mining address", () => {
		it("Should be able to set the liquidity mining address", async () => {
			await loanToken.setLiquidityMiningAddress(account2);
			expect(await loanToken.liquidityMiningAddress()).to.be.equal(account2);
		});

		it("Should fail to set the liquidity mining address with an unauthorized wallet", async () => {
			await expectRevert(loanToken.setLiquidityMiningAddress(account2, { from: account1 }), "unauthorized");
		});
	});

	async function deployLiquidityMining() {
		SOVToken = await TestToken.new("SOV", "SOV", 18, etherMantissa(1000000000));
		lockedSOVAdmins = [lender, account1, account2];
		//account 1 is a dummy value for the vesting registry
		lockedSOV = await LockedSOV.new(SOVToken.address, account1, 1, 10, lockedSOVAdmins);

		let liquidityMiningLogic = await LiquidityMiningLogic.new();
		let liquidityMiningProxy = await LiquidityMiningProxy.new();
		await liquidityMiningProxy.setImplementation(liquidityMiningLogic.address);
		liquidityMining = await LiquidityMiningLogic.at(liquidityMiningProxy.address);

		//dummy settings
		await liquidityMining.initialize(SOVToken.address, 10, 1, 1, account1, lockedSOV.address, 0);
	}

	async function deployProtocol() {
		//Token
		underlyingToken = await TestToken.new(name, symbol, 18, TOTAL_SUPPLY);
		testWrbtc = await TestWrbtc.new();

		const sovrynproxy = await sovrynProtocol.new();
		sovryn = await ISovryn.at(sovrynproxy.address);

		await sovryn.replaceContract((await LoanClosingsBase.new()).address);
		await sovryn.replaceContract((await LoanClosingsWith.new()).address);
		await sovryn.replaceContract((await ProtocolSettings.new()).address);
		await sovryn.replaceContract((await LoanSettings.new()).address);
		await sovryn.replaceContract((await LoanMaintenance.new()).address);
		await sovryn.replaceContract((await SwapsExternal.new()).address);
		await sovryn.replaceContract((await LoanOpenings.new()).address);

		await sovryn.setWrbtcToken(testWrbtc.address);

		feeds = await PriceFeedsLocal.new(testWrbtc.address, sovryn.address);
		await feeds.setRates(underlyingToken.address, testWrbtc.address, wei("0.01", "ether"));
		const swaps = await SwapsImplLocal.new();
		const sovrynSwapSimulator = await TestSovrynSwap.new(feeds.address);
		await sovryn.setSovrynSwapContractRegistryAddress(sovrynSwapSimulator.address);
		await sovryn.setSupportedTokens([underlyingToken.address, testWrbtc.address], [true, true]);
		await sovryn.setPriceFeedContract(
			feeds.address //priceFeeds
		);
		await sovryn.setSwapsImplContract(
			swaps.address // swapsImpl
		);
		await sovryn.setFeesController(lender);
	}

	async function deployLoanTokens() {
		loanTokenLogicLM = await LoanTokenLogicLM.new();
		loanToken = await LoanToken.new(lender, loanTokenLogicLM.address, sovryn.address, testWrbtc.address);
		await loanToken.initialize(underlyingToken.address, name, symbol); //iToken
		loanToken = await LoanTokenLogicLM.at(loanToken.address);

		params = [
			"0x0000000000000000000000000000000000000000000000000000000000000000", // bytes32 id; // id of loan params object
			false, // bool active; // if false, this object has been disabled by the owner and can't be used for future loans
			lender, // address owner; // owner of this object
			underlyingToken.address, // address loanToken; // the token being loaned
			testWrbtc.address, // address collateralToken; // the required collateral token
			wei("20", "ether"), // uint256 minInitialMargin; // the minimum allowed initial margin
			wei("15", "ether"), // uint256 maintenanceMargin; // an unhealthy loan when current margin is at or below this value
			2419200, // uint256 maxLoanTerm; // the maximum term for new loans (0 means there's no max term)
		];

		await loanToken.setupLoanParams([params], false);

		const loanTokenAddress = await loanToken.loanTokenAddress();
		if (lender == (await sovryn.owner())) await sovryn.setLoanPool([loanToken.address], [loanTokenAddress]);

		// --------------- WRBTC -----------------------//

		loanTokenLogicWRBTC = await LoanTokenLogicWRBTC.new();
		loanTokenWRBTC = await LoanToken.new(lender, loanTokenLogicWRBTC.address, sovryn.address, testWrbtc.address);
		await loanTokenWRBTC.initialize(testWrbtc.address, "iRBTC", "iRBTC");
		loanTokenWRBTC = await LoanTokenLogicWRBTC.at(loanTokenWRBTC.address);

		params = [
			"0x0000000000000000000000000000000000000000000000000000000000000000", // bytes32 id; // id of loan params object
			false, // bool active; // if false, this object has been disabled by the owner and can't be used for future loans
			lender, // address owner; // owner of this object
			testWrbtc.address, // address loanToken; // the token being loaned
			underlyingToken.address, // address collateralToken; // the required collateral token
			wei("20", "ether"), // uint256 minInitialMargin; // the minimum allowed initial margin
			wei("15", "ether"), // uint256 maintenanceMargin; // an unhealthy loan when current margin is at or below this value
			2419200, // uint256 maxLoanTerm; // the maximum term for new loans (0 means there's no max term)
		];

		await loanTokenWRBTC.setupLoanParams([params], false);
		await sovryn.setLoanPool([loanTokenWRBTC.address], [testWrbtc.address]);

		// ---------------- SUPPLY FUNDS TO PROTOCOL ---------------------//
		await testWrbtc.mint(sovryn.address, wei("500", "ether"));
		await underlyingToken.mint(sovryn.address, wei("50000", "ether"));
	}
});
