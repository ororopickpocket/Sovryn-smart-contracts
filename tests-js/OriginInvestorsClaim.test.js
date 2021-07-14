const { expect } = require("chai");
const { ethers } = require("hardhat");
const { expectRevert, expectEvent, constants, BN, balance, time } = require("@openzeppelin/test-helpers");

const { mineBlock, setNextBlockTimestamp } = require("./Utils/Ethereum");

const StakingLogic = artifacts.require("Staking");
const StakingProxy = artifacts.require("StakingProxy");
const SOV_ABI = artifacts.require("SOV");
const TestToken = artifacts.require("TestToken");
const TestWrbtc = artifacts.require("TestWrbtc");
const FeeSharingProxy = artifacts.require("FeeSharingProxyMockup");
const VestingLogic = artifacts.require("VestingLogic");
const VestingFactory = artifacts.require("VestingFactory");
const VestingRegistry = artifacts.require("VestingRegistry2"); //removed some methods from VestingRegistry to prevent double spendings
const OriginInvestorsClaim = artifacts.require("OriginInvestorsClaim");

const ONE_WEEK = new BN(7 * 24 * 60 * 60);
const TWO_WEEKS = ONE_WEEK.muln(2);
const SIX_WEEKS = ONE_WEEK.muln(6); //new BN(6 * 7 * 24 * 60 * 60);

const TOTAL_SUPPLY = "100000000000000000000000000";
const ONE_THOUSAND = "1000000000000000000000";
const ZERO_ADDRESS = constants.ZERO_ADDRESS;

const priceSats = "2500";

contract("OriginInvestorsClaim", (accounts) => {
	let root, initializer, account1, investor1, investor2, investor3;
	let SOV, kickoffTS;
	let staking, stakingLogic, feeSharingProxy;
	let vestingFactory, vestingLogic, vestingRegistry;
	let investors;
	let amounts, amount1, amount2, amount3;
	let investorsClaim;

	function getTimeFromKickoff(offset) {
		return kickoffTS.add(new BN(offset));
	}

	async function checkVestingContractCreatedAndStaked(txHash, receiver, cliff, amount) {
		const vestingAddress = await vestingRegistry.getVesting(receiver);
		await expectEvent.inTransaction(txHash, vestingRegistry, "VestingCreated", {
			tokenOwner: receiver,
			vesting: vestingAddress,
			cliff: cliff,
			duration: cliff,
			amount: amount,
		});

		//event TokensStaked(address indexed vesting, uint256 amount);
		await expectEvent.inTransaction(txHash, vestingRegistry, "TokensStaked", {
			vesting: vestingAddress,
			amount: amount,
		});

		const staked = await staking.balanceOf(vestingAddress);
		expect(staked, "The vesting contract is not staked").to.be.bignumber.equal(amount);
	}

	async function appendInvestorsAmountsList(_investors, _amounts, _fundContract = false) {
		await investorsClaim.appendInvestorsAmountsList(_investors, _amounts);
		if (_fundContract) {
			await fundContract(_amounts);
		}
	}

	async function fundContract(_amounts = amounts) {
		const totalReducer = (accumulator, currentValue) => accumulator.add(currentValue);
		const total = _amounts.reduce(totalReducer);
		await SOV.transfer(initializer, total);
		await investorsClaim.authorizedBalanceWithdraw(root); //nullify balance

		await SOV.transfer(investorsClaim.address, total, { from: initializer });
	}

	async function createOriginInvestorsClaimContract({
		_initializeInvestorsList = false,
		_fundContract = false,
		_investors = investors,
		_amounts = amounts,
	}) {
		investorsClaim = await OriginInvestorsClaim.new(vestingRegistry.address);

		if (_initializeInvestorsList) {
			await appendInvestorsAmountsList(_investors, _amounts);
		}

		if (_fundContract) {
			await fundContract(_amounts);
		}
	}

	before(async () => {
		[root, initializer, account1, investor1, investor2, investor3, claimedTokensReceiver, ...accounts] = accounts;
		investors = [investor1, investor2, investor3];
		amount1 = new BN(ONE_THOUSAND);
		amount2 = amount1.muln(2);
		amount3 = amount1.muln(5);
		amounts = [amount1, amount2, amount3];

		wrbtc = await TestWrbtc.new();
		SOV = await SOV_ABI.new(TOTAL_SUPPLY);
		cSOV1 = await TestToken.new("cSOV1", "cSOV1", 18, TOTAL_SUPPLY);
		cSOV2 = await TestToken.new("cSOV2", "cSOV2", 18, TOTAL_SUPPLY);

		stakingLogic = await StakingLogic.new(SOV.address);
		staking = await StakingProxy.new(SOV.address);
		await staking.setImplementation(stakingLogic.address);
		staking = await StakingLogic.at(staking.address);

		feeSharingProxy = await FeeSharingProxy.new(ZERO_ADDRESS, staking.address, wrbtc.address);

		vestingLogic = await VestingLogic.new();
		vestingFactory = await VestingFactory.new(vestingLogic.address);
		vestingRegistry = await VestingRegistry.new(
			vestingFactory.address,
			SOV.address,
			[cSOV1.address, cSOV2.address],
			priceSats,
			staking.address,
			feeSharingProxy.address,
			account1
		);
		await vestingFactory.transferOwnership(vestingRegistry.address);

		kickoffTS = await staking.kickoffTS.call();

		await createOriginInvestorsClaimContract({ _initializeInvestorsList: true });

		await vestingRegistry.addAdmin(investorsClaim.address);
	});

	describe("setInvestorsList", () => {
		beforeEach(async () => {
			await createOriginInvestorsClaimContract({ _initializeInvestorsList: false, _fundContract: true });
		});

		it("set investors list", async () => {
			//set first chunk of the list
			let tx = await investorsClaim.appendInvestorsAmountsList(investors.slice(0, 2), amounts.slice(0, 2));
			expectEvent(tx, "InvestorsAmountsListAppended", {
				qty: new BN(amounts.slice(0, 2).length),
				amount: amount1.add(amount2),
			});

			await verifyAmounts(2);

			tx = await investorsClaim.appendInvestorsAmountsList(investors, amounts);
			expectEvent(tx, "InvestorsAmountsListAppended", { qty: new BN(1), amount: amount3 });

			await verifyAmounts(3);

			async function verifyAmounts(upperBoundary) {
				for (i = 0; i < upperBoundary; i++) {
					amount = await investorsClaim.investorsAmountsList(investors[i]);
					expect(amount).to.be.bignumber.equal(new BN(amounts[i]), `wrong investors list assignment at index ${i}`);
				}
			}

			await createOriginInvestorsClaimContract({ _initializeInvestorsList: true, _fundContract: false });
			await expectRevert(
				investorsClaim.setInvestorsAmountsListInitialized(),
				"OriginInvestorsClaim::setInvestorsAmountsList: the contract is not enough financed"
			);

			await fundContract(amounts);
			await investorsClaim.setInvestorsAmountsListInitialized();

			await expectRevert(
				investorsClaim.appendInvestorsAmountsList(investors, amounts),
				"OriginInvestorsClaim::notInitialized: the investors list should not be set as initialized"
			);
		});

		it("cannot add investors to the list after setInvestorsAmountsListIntilized() called", async () => {
			await createOriginInvestorsClaimContract({ _initializeInvestorsList: true, _fundContract: true });

			await investorsClaim.setInvestorsAmountsListInitialized();

			await expectRevert(
				investorsClaim.appendInvestorsAmountsList(investors, amounts),
				"OriginInvestorsClaim::notInitialized: the investors list should not be set as initialized"
			);
		});

		it("fails if investors.length != amounts.length", async () => {
			await createOriginInvestorsClaimContract({ _initializeInvestorsList: true, _fundContract: true });

			const investorsReduced = investors.slice(1);
			await expectRevert(
				investorsClaim.appendInvestorsAmountsList(investorsReduced, amounts),
				"investors.length != claimAmounts.length"
			);
		});

		it("only authorised can whitelist investors", async () => {
			await expectRevert(
				investorsClaim.appendInvestorsAmountsList(investors, amounts, { from: account1 }),
				"OriginInvestorsClaim::onlyAuthorized: should be authorized"
			);
		});
	});

	describe("process claims", () => {
		before(async () => {
			await createOriginInvestorsClaimContract({ _initializeInvestorsList: true, _fundContract: true });
			await vestingRegistry.addAdmin(investorsClaim.address);
			//await fundContract({ approve: true, transfer: false });
		});
		it("should create vesting contract within vesting period", async () => {
			await expectRevert(
				investorsClaim.claim({ from: investor1 }),
				"OriginInvestorsClaim::initialized: the investors list has not been set yet"
			);

			await investorsClaim.setInvestorsAmountsListInitialized();

			const timeFromKickoff = getTimeFromKickoff(ONE_WEEK);
			await setNextBlockTimestamp(timeFromKickoff.toNumber());
			tx = await investorsClaim.claim({ from: investor1 });

			await expectEvent(tx.receipt, "ClaimVested", {
				investor: investor1,
				amount: amount1,
			});

			let txHash = tx.receipt.transactionHash;

			await checkVestingContractCreatedAndStaked(txHash, investor1, SIX_WEEKS.sub(ONE_WEEK), amount1);

			expect(await investorsClaim.investorsAmountsList(investor1)).to.be.bignumber.equal(new BN(0));

			await setNextBlockTimestamp(getTimeFromKickoff(SIX_WEEKS).subn(1).toNumber());
			tx = await investorsClaim.claim({ from: investor2 });

			await expectEvent(tx.receipt, "ClaimVested", {
				investor: investor2,
				amount: amount2,
			});

			txHash = tx.receipt.transactionHash;

			await checkVestingContractCreatedAndStaked(txHash, investor2, new BN(1), amount2);

			expect(await investorsClaim.investorsAmountsList(investor2)).to.be.bignumber.equal(new BN(0));

			//TODO: check vesting created and the user is in the list
		});

		// address1 claims - failure

		it("should get SOV directly when claiming after the cliff", async () => {
			let balance;
			// investor2 claims within cliff - vesting contract created with amounts[1]
			// move time 1 ms past cliff
			await setNextBlockTimestamp((await getTimeFromKickoff(SIX_WEEKS)).addn(100).toNumber());
			await mineBlock();

			balance = await SOV.balanceOf(investor3);
			expect(balance).to.be.bignumber.equal(new BN(0));

			// await SOV.transfer(vestingRegistry.address, amount3);
			tx = await investorsClaim.claim({ from: investor3 });

			await expectEvent(tx.receipt, "ClaimTransferred", {
				investor: investor3,
				amount: amount3,
			});

			balance = await SOV.balanceOf(investor3);
			expect(balance).to.be.bignumber.equal(amount3);
		});

		it("investors with vesting contracts created cannot withdraw here", async () => {
			await expectRevert(
				investorsClaim.claim({ from: investor1 }),
				"OriginInvestorsClaim::onlyWhitelisted: not whitelisted or already claimed"
			);
		});

		it("can withdraw only once", async () => {
			await expectRevert(
				investorsClaim.claim({ from: investor3 }),
				"OriginInvestorsClaim::onlyWhitelisted: not whitelisted or already claimed"
			);
		});

		it("owner should be able to move SOV balances from the contract", async () => {
			const balanceBefore = await SOV.balanceOf(investorsClaim.address);

			await investorsClaim.authorizedBalanceWithdraw(account1);

			expect(await SOV.balanceOf(account1)).to.be.bignumber.equal(balanceBefore);
			expect(await SOV.balanceOf(investorsClaim.address)).to.be.bignumber.equal(new BN(0));
		});

		it("allows to claim only from whitelisted addresses", async () => {
			await expectRevert(investorsClaim.claim({ from: account1 }), "not whitelisted or already claimed");
		});
	});
});
