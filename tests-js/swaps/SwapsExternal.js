const { expectRevert, expectEvent, BN, constants } = require("@openzeppelin/test-helpers");

const TestToken = artifacts.require("TestToken");
const TestWrbtc = artifacts.require("TestWrbtc");

const sovrynProtocol = artifacts.require("sovrynProtocol");
const ProtocolSettings = artifacts.require("ProtocolSettings");
const ISovryn = artifacts.require("ISovryn");

const LoanToken = artifacts.require("LoanToken");
const LoanTokenLogicStandard = artifacts.require("LoanTokenLogicStandard");
const LoanSettings = artifacts.require("LoanSettings");
const LoanMaintenance = artifacts.require("LoanMaintenance");
const SwapsExternal = artifacts.require("SwapsExternal");

const PriceFeedsLocal = artifacts.require("PriceFeedsLocal");
const TestSovrynSwap = artifacts.require("TestSovrynSwap");
const SwapsImplSovrynSwap = artifacts.require("SwapsImplSovrynSwap");

const StakingLogic = artifacts.require("StakingMockup");
const StakingProxy = artifacts.require("StakingProxy");

const FeeSharingProxy = artifacts.require("FeeSharingProxy");
const ProtocolSettingsMockup = artifacts.require("ProtocolSettingsMockup");

const TOTAL_SUPPLY = web3.utils.toWei("1000", "ether");
const { ZERO_ADDRESS } = constants;
const wei = web3.utils.toWei;
const hunEth = new BN(wei("100", "ether"));
const TWO_WEEKS = 86400 * 14;

contract("SwapsExternal", (accounts) => {
	const name = "Test token";
	const symbol = "TST";

	let lender;
	let underlyingToken, testWrbtc;
	let sovryn, loanToken;

	before(async () => {
		[lender, staker] = accounts;
	});

	beforeEach(async () => {
		//Token
		underlyingToken = await TestToken.new(name, symbol, 18, TOTAL_SUPPLY);
		testWrbtc = await TestWrbtc.new();

		const sovrynproxy = await sovrynProtocol.new();
		sovryn = await ISovryn.at(sovrynproxy.address);

		await sovryn.replaceContract((await ProtocolSettings.new()).address);
		await sovryn.replaceContract((await ProtocolSettingsMockup.new()).address);
		await sovryn.replaceContract((await LoanSettings.new()).address);
		await sovryn.replaceContract((await LoanMaintenance.new()).address);
		await sovryn.replaceContract((await SwapsExternal.new()).address);

		await sovryn.setWrbtcToken(testWrbtc.address);

		feeds = await PriceFeedsLocal.new(testWrbtc.address, sovryn.address);
		await feeds.setRates(underlyingToken.address, testWrbtc.address, wei("1", "ether"));
		const swaps = await SwapsImplSovrynSwap.new();
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

		loanTokenLogicStandard = await LoanTokenLogicStandard.new();
		loanToken = await LoanToken.new(lender, loanTokenLogicStandard.address, sovryn.address, testWrbtc.address);
		await loanToken.initialize(underlyingToken.address, name, symbol); //iToken
		loanToken = await LoanTokenLogicStandard.at(loanToken.address);

		//Staking
		let stakingLogic = await StakingLogic.new(underlyingToken.address);
		staking = await StakingProxy.new(underlyingToken.address);
		await staking.setImplementation(stakingLogic.address);
		staking = await StakingLogic.at(staking.address);

		//FeeSharingProxy
		feeSharingProxy = await FeeSharingProxy.new(sovryn.address, staking.address);
		await sovryn.setFeesController(feeSharingProxy.address);

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

		await testWrbtc.mint(sovryn.address, wei("500", "ether"));
	});

	describe("SwapsExternal - Swap External", () => {
		it("Doesn't allow fallback function calls", async () => {
			const swapsExternal = await SwapsExternal.new();
			await expectRevert(
				swapsExternal.send(wei("0.0000000000000001", "ether")),
				"fallback function is not payable and was called with value 100"
			);
			await expectRevert(swapsExternal.sendTransaction({}), "fallback not allowed");
		});

		it("Doesn't allow swaps if source token amount = 0", async () => {
			await expectRevert(
				sovryn.swapExternal(underlyingToken.address, testWrbtc.address, accounts[0], accounts[0], 0, 0, 0, "0x"),
				"sourceTokenAmount == 0"
			);
		});

		it("Doesn't allow swaps without enough allowance", async () => {
			await expectRevert(
				sovryn.swapExternal(underlyingToken.address, testWrbtc.address, accounts[0], accounts[0], hunEth, 0, 0, "0x"),
				"SafeERC20: low-level call failed"
			);
		});

		it("Doesn't allow swaps if token address contract unavailable", async () => {
			await expectRevert(
				sovryn.swapExternal(ZERO_ADDRESS, testWrbtc.address, accounts[0], accounts[0], 100, 0, 0, "0x"),
				"function call to a non-contract account"
			);
		});

		it("Doesn't allow swaps if source token address is missing", async () => {
			const assetBalance = await loanToken.assetBalanceOf(lender);
			await underlyingToken.approve(sovryn.address, assetBalance.add(new BN(wei("10", "ether"))).toString());
			await expectRevert(
				sovryn.swapExternal(ZERO_ADDRESS, testWrbtc.address, accounts[0], accounts[0], wei("1", "ether"), 0, 0, "0x", {
					value: wei("1", "ether"),
				}),
				"swap failed"
			);
		});

		it("Doesn't allow swaps if destination token is zero address", async () => {
			const assetBalance = await loanToken.assetBalanceOf(lender);
			await underlyingToken.approve(sovryn.address, assetBalance.add(new BN(wei("10", "ether"))).toString());
			await expectRevert(
				sovryn.swapExternal(underlyingToken.address, ZERO_ADDRESS, accounts[0], accounts[0], 100, 0, 0, "0x"),
				"swap failed"
			);
		});

		it("Doesn't allow source token mismatch", async () => {
			const assetBalance = await loanToken.assetBalanceOf(lender);
			await underlyingToken.approve(sovryn.address, assetBalance.add(new BN(wei("10", "ether"))).toString());
			await expectRevert(
				sovryn.swapExternal(underlyingToken.address, testWrbtc.address, accounts[0], accounts[0], wei("1", "ether"), 0, 0, "0x", {
					value: wei("1", "ether"),
				}),
				"sourceToken mismatch"
			);
		});

		it("Doesn't allow source token amount mismatch", async () => {
			const assetBalance = await loanToken.assetBalanceOf(lender);
			await testWrbtc.approve(sovryn.address, assetBalance.add(new BN(wei("10", "ether"))).toString());
			await expectRevert(
				sovryn.swapExternal(testWrbtc.address, underlyingToken.address, accounts[0], accounts[0], wei("1", "ether"), 0, 0, "0x", {
					value: 100,
				}),
				"sourceTokenAmount mismatch"
			);
		});

		it("Check swapExternal with minReturn > 0 should revert if minReturn is not valid (higher)", async () => {
			const assetBalance = await loanToken.assetBalanceOf(lender);
			await underlyingToken.approve(sovryn.address, assetBalance.add(new BN(wei("10", "ether"))).toString());
			await expectRevert(
				sovryn.swapExternal(
					underlyingToken.address,
					testWrbtc.address,
					accounts[0],
					accounts[0],
					wei("1", "ether"),
					0,
					wei("10", "ether"),
					"0x"
				),
				"destTokenAmountReceived too low"
			);
		});

		it("Check swapExternal with minReturn > 0 should revert if minReturn is valid", async () => {
			const assetBalance = await loanToken.assetBalanceOf(lender);
			await underlyingToken.approve(sovryn.address, assetBalance.add(new BN(wei("10", "ether"))).toString());
			// feeds price is set 0.01, so test minReturn with 0.01 as well for the 1 ether swap
			const tx = await sovryn.swapExternal(
				underlyingToken.address,
				testWrbtc.address,
				accounts[0],
				accounts[0],
				wei("1", "ether"),
				0,
				wei("0.01", "ether"),
				"0x"
			);
			const fields = await sovryn.swapExternal.call(
				underlyingToken.address,
				testWrbtc.address,
				accounts[0],
				accounts[0],
				wei("1", "ether"),
				0,
				wei("0.01", "ether"),
				"0x"
			);
			expectEvent(tx, "ExternalSwap", {
				user: lender,
				sourceToken: underlyingToken.address,
				destToken: testWrbtc.address,
				sourceAmount: wei("1", "ether"),
				destAmount: fields.destTokenAmountReceived.toString(),
			});

			let destTokenAmount = await sovryn.getSwapExpectedReturn(underlyingToken.address, testWrbtc.address, wei("1", "ether"));
			const trading_fee_percent = await sovryn.tradingFeePercent();
			const trading_fee = destTokenAmount.mul(trading_fee_percent).div(hunEth);
			let desTokenAmountAfterFee = destTokenAmount - trading_fee;
			assert.equal(desTokenAmountAfterFee, fields.destTokenAmountReceived.toString());
		});

		it("Should be able to withdraw fees", async () => {
			const assetBalance = await loanToken.assetBalanceOf(lender);
			await underlyingToken.approve(sovryn.address, assetBalance.add(new BN(wei("10", "ether"))).toString());
			// feeds price is set 0.01, so test minReturn with 0.01 as well for the 1 ether swap
			await sovryn.swapExternal(
				underlyingToken.address,
				testWrbtc.address,
				accounts[0],
				accounts[0],
				wei("1", "ether"),
				0,
				wei("0.01", "ether"),
				"0x"
			);

			const fields = await sovryn.swapExternal.call(
				underlyingToken.address,
				testWrbtc.address,
				accounts[0],
				accounts[0],
				wei("1", "ether"),
				0,
				wei("0.01", "ether"),
				"0x"
			);

			let destTokenAmount = await sovryn.getSwapExpectedReturn(underlyingToken.address, testWrbtc.address, wei("1", "ether"));
			const trading_fee_percent = await sovryn.tradingFeePercent();
			const trading_fee = destTokenAmount.mul(trading_fee_percent).div(hunEth);
			await underlyingToken.transfer(sovryn.address, wei("1", "ether"));

			//stake - getPriorTotalVotingPower
			let amount = trading_fee;
			//await underlyingToken.transfer(lender, amount);
			await underlyingToken.approve(staking.address, amount, { from: lender });
			let kickoffTS = await staking.kickoffTS.call();
			await staking.stake(amount, kickoffTS.add(new BN(TWO_WEEKS)), lender, lender, { from: lender });

			const tx = await feeSharingProxy.withdrawFees(underlyingToken.address);

			expectEvent(tx, "FeeWithdrawn", {
				sender: lender,
				token: loanToken.address,
				amount: trading_fee,
			});
		});

		it("Check swapExternal with minReturn > 0 should revert if minReturn is valid", async () => {
			await expectRevert(
				sovryn.checkPriceDivergence(underlyingToken.address, testWrbtc.address, wei("1", "ether"), wei("2", "ether")),
				"destTokenAmountReceived too low"
			);
		});
	});
});
