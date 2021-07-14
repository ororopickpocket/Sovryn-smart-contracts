pragma solidity ^0.5.17;

import "../rsk/RSKAddrValidator.sol";

// contract for testing libraries
contract TestLibraries {
	/*
	 * @param addr it is an address to check that it does not originates from
	 * signing with PK = ZERO. RSK has a small difference in which @ZERO_PK_ADDR is
	 * also an address from PK = ZERO. So we check for both of them.
	 */
	function RSKAddrValidator_checkPKNotZero(address addr) public pure returns (bool) {
		return (RSKAddrValidator.checkPKNotZero(addr));
	}

	/*
	 * Safely compares two addresses, checking they do not originate from
	 * a zero private key
	 */
	function RSKAddrValidator_safeEquals(address addr1, address addr2) public pure returns (bool) {
		return (RSKAddrValidator.safeEquals(addr1, addr2));
	}
}
